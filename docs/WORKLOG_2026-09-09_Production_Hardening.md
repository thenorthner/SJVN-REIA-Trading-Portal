# Worklog — 09 Sep 2026
## Production hardening: indexes, audit boot, aur document numbering

**Branch:** `feat/trading-settlement-billing`
**Trigger:** "production level pe system fail na ho ye ensure karde" — phir DB
choice ka sawal.

---

## DB ka faisla: SQLite hi rahegi

Naapa hua: **6.9 MB, 129 tables, 7,751 rows total.** Sabse badi table
`cerc_market_data` — 3,083 rows. 54 tables abhi khaali hain. SQLite ki capacity
ka lagbhag 0.001% use ho raha hai.

Scope document (`CP -11-43 Final Scope by Committee`) mein "scalable,
configurable, adaptable" likha hai par **koi specific database mandate nahi**,
koi concurrent-user number nahi, koi uptime SLA nahi. To compliance ki taraf se
bhi koi majboori nahi.

Migration ka asli kharcha data nahi, **code** hai: `better-sqlite3` ka
synchronous API 156 files mein bikhra hai. Postgres par har route async karna
padega — port nahi, rewrite.

**Postgres tab chahiye jab:** multiple app servers (HA/load balancing),
replication/PITR, ya SJVN IT policy enterprise RDBMS maange. Tab PostgreSQL,
MySQL/Oracle nahi.

---

## 1. Indexes — jo tables badhti hain

`energy_data`, `implemented_schedule_blocks`, `daily_schedule_entries`,
`bid_blocks`, `bilateral_schedules`, `audit_logs`, `notifications` — in sab par
sirf PRIMARY KEY ka auto-index tha. Har lookup full table scan.

15 indexes daale (`schema.sql` ke aakhir mein). Column order us query se aata
hai jo actually chalti hai — filter pehle, phir sort column, taaki sorting index
se hi nikal aaye.

Do saal ka data simulate karke naapa (800k audit rows, 400k energy rows, 1.1 GB):

| Query | Pehle | Ab |
|---|---|---|
| audit: ek invoice ki history | 1291 ms | 0 ms |
| audit: ek request trace | 394 ms | 0 ms |
| audit: ek user ki activity | 521 ms | 1 ms |
| energy_data: ek contract-month | 47 ms | 0 ms |

`better-sqlite3` synchronous hai — wo 1291 ms **poora event loop block** karta,
yaani us waqt har user ka request ruka rehta. Real DB par migration 12 ms.

Ek proposed index hata bhi diya: `deviation_settlements` ka UNIQUE constraint
pehle se wahi index de raha tha; duplicate sirf write cost badhata.

---

## 2. Audit chain ka boot cost

`repairAuditChainIfBroken()` har boot par `verifyLogIntegrity()` chalata tha, jo
`SELECT * FROM audit_logs` **poora memory mein** load karta tha — aur ye
`server.js` ke import time par hota tha, port bind hone se pehle.

800k rows par naapa:

| | Pehle | Ab |
|---|---|---|
| Boot check | 11.2 s, 1.6 GB RSS | **2 ms, 44 MB** |
| Full verify (on-demand) | 1.6 GB | 3.9 s, 75 MB (streams) |

`audit_logs` har action par ek row leti hai aur kabhi prune nahi hoti. Aage
chalke boot us health check se lamba ho jaata jiska `update.sh` intezaar karta
hai — aur ek bilkul theek release **bina wajah rollback** ho jaata.

**Kya badla:**
- `verifyLogIntegrity()` ab `.iterate()` se stream karta hai — memory flat.
- Naya `verifyRecentIntegrity(limit)` — boot par sirf aakhri 200 links.
- Repair ab `platform_meta` marker se **ek hi baar** chalta hai (naya
  `src/db/meta.js`).
- `rebuildAuditChain()` rowid se page karta hai (2000/batch).
- `detectSoDViolations()` bhi paged — `+action` ka `+` load-bearing hai, wo
  SQLite ko index use karne se rokta hai taaki insertion order free mile
  (warna temp B-tree poora result set materialise kar deta).

**Behaviour ka ek accha side-effect:** pehle koi chain tode to boot use chupchaap
rebuild kar deta tha — yaani edited rows ko re-certify karke saaf dikha deta.
Ab repair ke baad **toota chain toota hi rehta hai**.

13 naye tests — `tests/auditChain.test.js`. Pehle is code par zero coverage thi.

---

## 3. Document numbering — asli production bug

Test suite 6 mein se 1 baar randomly fail ho rahi thi. Pehle confirm kiya ki
**mere changes se nahi** (indexes disable karke 8 runs). Khodne par ye nikla:

### 3a. `newId()` sirf 32 bits ka tha

`prefix + uuidv4().slice(0, 8)` — 4.29 arab values, **184 call sites**, aur ye
sab PRIMARY KEY columns hain.

```
 77,000 rows ek table mein → 50% chance do ids same
200,000 rows              → 99%
```

`audit_logs` kuch mahine ke use mein 77,000 cross karegi. Uske baad collision =
INSERT reject = **invoice raise karna ya contract approve karna randomly fail**,
aur wajah invoice se bilkul unrelated dikhegi (audit insert route ke apne
transaction ke andar hota hai).

Ab 16 hex chars = 64 bits (5 arab rows tak safe). Purane 8-char ids naye
16-char se kabhi takra nahi sakte. Teen aur jagah wahi 8-char generator tha —
`db/index.js`, `routes/billingSettlement.js`, aur traceId — sab widen kiye.

**Verify kiya ki width safe hai:** frontend mein saare `.slice(0,10)` dates par
hain, ids par nahi; schema mein koi VARCHAR/CHAR length limit nahi; IEX/PXIL
payloads mein ids nahi jaate.

### 3b. Document numbers random the

`genInvoiceNo` 6 random digits. `genDisputeNo` / `genReconNo` /
`genInstrumentNo` / `genInvocationNo` sirf **4 digits = 9,000 values**.

Ye **nau UNIQUE columns** mein jaate hain — repeat matlab INSERT reject, 500
error, document banta hi nahi:

```
  500 documents ek saal mein →  12% saal duplicate dekhte
 1000                        →  41%
 2000                        →  90%
```

Sirf `hydroBilling.js` ne ye notice kiya tha aur retry loop lagaya tha; baaki
gyaarah call sites ne nahi.

Ab sab us hi atomic register se aate hain jo SJVN invoice series pehle se use
karti thi (`nextInvoiceSeq` → naya export `nextSeriesNo`). 20,000 numbers test
kiye — zero duplicates. Padding itni rakhi ki purane random range se takra na
sake (4-digit walon ke liye 5 digits, 6-digit ke liye 6).

`hydroLedger.genDocNo` aur `exchangeBiddingLatest.genTransactionId` chhode —
pehle wale mein 12-attempt uniqueness retry hai, doosre mein timestamp +
3×base36 ka bada space.

### 3c. Masters params ka 5-second wall-clock cache

`loadParamMap()` mein `CACHE_MS = 5000`. Ek parameter change kabhi turant lagta
tha, kabhi 5 second baad — **clock par depend karta tha**.

Saare writers (`masters.js` create/update, `ensureMasterDefaults`) pehle se
`invalidateParamCache()` call karte hain, to timer kuch protect nahi kar raha
tha — sirf behaviour unpredictable bana raha tha. Ab cache write par invalidate
hota hai, timer nahi.

Naapa: 77 rows ka full uncached read 59 µs — cache rakhne layak hai, TTL nahi.

---

## Flake: 33% → 8%, poora khatam nahi

25 consecutive full runs mein 23 clean. Pehle har chauthi-paanchvi run failing
thi. Ye seedha deploys ka issue hai — `update.sh` test fail par **rollback**
karti hai.

### Jo rule out ho chuka hai

- **Mere changes:** nahi. Indexes disable karke bhi hota tha.
- **Worker DB cross-talk:** nahi. 65 files → 65 alag pids, 65 alag DB paths
  (instrument karke ginaa).
- **Parallelism:** nahi. `maxWorkers: 2` par bhi hota hai, aur single file
  akela 25 baar chalane par bhi 1 baar hua.
- **Test file order / shared fixtures:** har file apne process aur apne DB mein.

### Aakhri lead (yahin se shuru karna)

Aakhri do failures mein test ko **404 / 403 mila, par server-side logs mein us
request ka koi corresponding entry hi nahi tha.** Instrumentation middleware
chain ke bilkul upar thi (cors/body-parser se pehle, `res.on('finish')` +
`res.on('close')`), to request app tak pahunchti to log hoti.

Iska matlab shak **application code par nahi, test harness par** jaata hai —
jaise supertest ka response correlation, ya ek hi `app` par concurrent requests.
Agar ye sach hai to **ye production bug nahi hai**, sirf test infrastructure ka
hai — jo iski priority kaafi girata hai.

**Agla step:** supertest ko khud instrument karna (request→response pairing par),
ya `--no-file-parallelism` ke saath bisect karna.

---

## Verify kiya

- 1130 tests pass (65 files), 24 naye tests jodhe.
- Real DB par migration 12 ms, schema clean apply.
- Har naya index `EXPLAIN QUERY PLAN` se confirm — sab index use kar rahe hain,
  koi temp B-tree nahi.
- Production mode mein actual boot: backup bana, audit scan skip hua, health ok,
  graceful shutdown chala.

## Jo nahi kiya (jaan-boojh kar)

- **Commit nahi kiya** — `schema.sql` aur `db/index.js` mein hydro billing ka
  in-progress kaam mere changes ke saath mila hua hai.
- **`update.sh` ko flake-tolerant nahi banaya** — test fail par rollback karna
  safe direction hai. Retry lagane se ek sach mein toota release nikal sakta hai.
