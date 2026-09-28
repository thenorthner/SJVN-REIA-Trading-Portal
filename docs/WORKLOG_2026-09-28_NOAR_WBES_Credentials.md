# Worklog — 28 Sep 2026
## NOAR & WBES credentials aa gaye — config, probe tool, aur jo abhi bhi missing hai

**Branch:** `feat/trading-settlement-billing`
**Trigger:** O/o CGM (Power Trading & BD), New Delhi ne NOAR ka API key + secret
aur WBES ka API key mail kiya — `docs/PowerTrading_NOAR_WBES_Credentials_Email_Draft.md`
wali request ka jawab.

> **Credential kahin bhi git mein nahi hai.** Sirf `backend/.env` mein (gitignore
> line 3, `chmod 600`). Is file mein, kisi doc mein, ya kisi capture mein key ya
> secret nahi likha — reference ke liye sirf fingerprint (SHA-256 ke pehle 8 hex):
> key `18d60848`, secret `67035c20`.

---

## NOAR — jo pata chala (bina koi call kiye)

Secret ek JWT hai, decode karne pe:

| Claim | Value | Matlab |
|---|---|---|
| `iat` / `exp` | 16-May-2026 → 16-May-2027 | **Purana key hai, aaj generate nahi hua** — yahi maanga tha |
| `UserDetails.Username` | SJVN Limited | Role `APPLICANT`, `powertradingsjvn@gmail.com`, login `Sjvnpt123` |
| `groupsid` | key ke barabar | Key aur secret **ek pair** hain — mismatch ho to key regenerate ho chuka hai |
| `iss` / `aud` | NOAR-TP / NOAR-API-TP | Environment (prod ya test) kahin nahi likha |

Sabse important baat: **iat May ka hai, aaj ka nahi** — yaani handover mein kuch
deactivate nahi hua, aur May se jo bhi is key ko use kar raha hai wo chalta
rahega. Ab is login se **kabhi naya key generate nahi karna** — hum aur wo dono
isi ek key pe hain.

## WBES — URL aur username aa gaye (usi din, baad mein), acronym abhi bhi shaq mein

Grid India ne bheja:

| Kya | Value | Dikkat |
|---|---|---|
| API URL | `https://gateway.grid-india.in/POSOCO/reports/1.0/WebAccessAPI/GetUtilityExternalSharedData?apikey=` | Ye **poora endpoint** hai, base nahi — seedha `wbes_base_url` mein daal dete to URL mein path do baar aa jaata aur ek latka hua `apikey=` |
| Username | `usr_SJVNL` | Guide ke example (`usr_entity_integration`) se pattern match |
| Utility acronym | "SJVN Limited" | Ye **naam** hai, acronym nahi. Guide mein har acronym token hai (`BIHAR_STATE`, `BSPHCL`) |

Acronym pe guess nahi kiya — **galat acronym khaali list deta hai**, jo "us din
schedule nahi tha" jaisa padhta hai, aur wo seedha invoice mein chala jaata. Isliye
`WBES_UTILITY_ACRONYM` **khaali** chhoda hai aur candidates likh diye: `SJVNL`
(username se match karta hai, aur ISET ke block-wise report mein bhi `trader_name:
SJVNL` hai), `SJVN Limited`, `SJVN`, ya khaali list (guide ka dusra example — jo
credential ke scope ka sab deta hai; sabse tikaau option yahi hoga).

### Code mein kya badla (`wbesService.js`)

- **`normaliseBaseUrl()`** — `/reports/...` se aage aur query string kaat deta
  hai, to unka bheja poora URL ya chhota base, dono chalte hain.
- **`fetchLatestRevisionNo()`** (guide 3.2, `GetLatestFullSchdRevNo`) — iska body
  sirf `{Date, UserName}` hai, **acronym nahi**. Yahi pehli call honi chahiye:
  URL, key, username aur whitelisting — chaaron ek saath prove ho jaate hain, aur
  acronym ka jhagda beech mein nahi aata.
- **`readStatus()`** — WBES apni galti HTTP 200 ke andar `WBES-400 "API Access
  Validation Failed"` bhej deta hai. Pehle hum sirf HTTP status dekhte the, yaani
  refusal "khaali schedule" ban jaata. Ab error banta hai.
- Key ab header **aur** query dono mein jaati hai (guide dono allow karta hai,
  unhone query form diya). `WBES_KEY_IN_QUERY=false` se band ho jayegi jab pata
  chale header akela chalta hai — credential URL mein rakhna achha nahi.
- Naye tests: `backend/tests/wbesService.test.js` (12). Poora suite 1730 pass.

### Probe

WBES section ab pehle revision-no (dono key style) maarta hai, phir schedule ko
**chaar acronym candidate** ke saath — jo `WBES-200` ke saath `GroupWiseDataList`
rows de, wahi configure hoga. Mock gateway ke against verify kiya: header-only
`WBES-400`, query `WBES-200`; `SJVNL` aur khaali list rows dete hain, baaki khaali.

## WBES — pehle jo samajh mein aaya tha

Request body mein `UserName` aur `UtilAcronymList` jaate hain, aur guide saaf
kehta hai ki **username usi credential ka hona chahiye jiske against key issue
hua**. Guide mein host bhi nahi chhapa hai (per-instance hota hai). To WBES ke
liye teen cheez pending hain: **base URL, username, utility acronym.**

---

## Kya kiya

1. **`backend/.env`** — NOAR key/secret aur WBES key likhe. Dono `ENABLED=false`
   rakhe: NOAR sirf whitelisted IP (49.50.97.173) ko jawab deta hai, to laptop pe
   `true` karne se kaam karta stub ek 403 mein badal jaata. Server pe flip karna hai.
2. **`backend/.env.example`** — NOAR aur WBES ke blocks (placeholders, koi value
   nahi), plus IEX ka `IEX_MAX_REQUESTS_PER_SEC` jo 25-Sep ke change ke saath
   chhoot gaya tha.
3. **`tools/noar-probe/`** — PXIL probe wale hi pattern pe: ek standalone file,
   koi dependency nahi, server pe chalti hai, capture likhti hai. Paanch call per
   host: `isRejected` dono taraf, ek jaan-boojh ke 120-din ka range (guide ek
   mahine ki limit bolti hai, platform usi hisaab se chunk karta hai), aur ek
   **galat credential wala control** — warna gateway ka 403 aur NOAR ka apna 401
   ek jaisa dikhta hai. Production aur test dono host try karti hai, kyunki pair
   khud nahi bataata wo kis ka hai.
   Capture mein credential nahi jaata: key query string mein jaati hai isliye URL
   hi record nahi hota — sirf path, non-secret body, aur fingerprint. Mock ke
   against end-to-end test kiya (`--base=`), 4 call, 0 credential string.
4. **`docs/PowerTrading_WBES_Missing_Details_Email_Draft.md`** — WBES ke teen
   missing item, NOAR ka environment, aur 49.50.97.173 ki whitelisting — kya
   already registered hai ya Grid India ko forward karna padega.

Poora backend suite pass: 114 file / 1718 test (naya `.env` maujood hone ke saath bhi —
dono integration disabled hain to stub mode waise hi chalta hai).

---

## Hit-and-try ka jawab — maap ke dekh liya (koi asli credential bheje bina)

Sawaal tha: jo diya hai wahi daal ke try kar lein? Reachability check kiya, aur
dono platform bilkul alag behave karte hain:

| | WBES `gateway.grid-india.in` | NOAR `external.noar.in` / `devdr.noar.in:84` |
|---|---|---|
| DNS | 150.107.103.15 | resolve hota hai |
| TCP 443 | **khulta hai** | khulta hai |
| TLS handshake | **silently drop** — ClientHello ke 1559 byte jaate hain, **0 byte** wapas, koi certificate nahi | **poora hota hai**, certificate milta hai |
| TLS 1.2 force karke | wahi drop (to version/cipher ka masla nahi) | — |
| Galat key se call | ho hi nahi sakti | **HTTP 500, empty body**, ~140ms |

Do nateeje:

1. **WBES pe hit-and-try possible hi nahi.** Unregistered IP se connection TLS ke
   beech mein kat jaata hai, yaani **API key machine se nikalti hi nahi**. To key,
   username, acronym — kuch bhi test nahi ho sakta jab tak IP register na ho.
   Whitelisting optional nahi, pehla aur akela gate hai.
2. **NOAR reachable hai**, par uska refusal **bare HTTP 500 + empty body** hai —
   na 401, na guide §1.7 wala NOAR-4xx. Iska matlab "IP registered nahi" aur "key
   galat" bilkul ek jaise dikhte hain, aur dono NOAR ke server fault jaise lagte
   hain. (Ye control maine **jaan-boojh ke galat key** se maara — asli credential
   unregistered IP se nahi bheji.)

### Code mein utaar diya

- `wbesService.js` → `describeTransportError()`: Node ka flat "fetch failed" ab
  poori baat kehta hai — gateway TCP accept karke TLS pe drop karta hai, yahi
  "IP whitelisted nahi" ka shakal hai, key bheji hi nahi gayi, to ise outage
  samajh ke key check karne na baithe koi. Test bhi hai.
- `noarTraderService.js` → 500-with-empty-body ab naam se pehchana jaata hai, aur
  error message saaf kehta hai ki isse ye pata **nahi** chalta ki IP galat hai ya
  credential — dono mein se ek, bas.
- Dono mail drafts mein ye measurement likh diya: WBES wale mein "isi wajah se
  pehle kuch verify nahi kar sakte", NOAR wale mein ek polite observation ki
  documented NOAR-4xx body bhejein to members ka bahut guesswork bachega.

## Phir asli credential se maara (user ne kaha) — NOAR **chal gaya**

Laptop se, IP `223.31.159.139` (unregistered):

| Call | Natija |
|---|---|
| `external.noar.in` (production) | **200, NOAR-200, 134 real applications** (Aug-2026 range) |
| `devdr.noar.in:84` (test) | **401, empty body** — key production-only hai |
| Galat key ka control (dono host) | 500, empty body |
| WBES gateway, saari 6 call | `fetch failed` — TLS drop, jaisa predict kiya tha |

**Sabse bada nateeja: NOAR production IP filter nahi karta.** PXIL aur IEX dono
karte hain, guide §1.5 bhi "mutual IP whitelisting" likhta hai — isliye maan liya
tha ki yahan bhi pehla gate wahi hoga. Nahi hai. To **NOAR ke liye whitelisting
mail ki zaroorat hi nahi** — wo draft hata diya (ab
`docs/NOAR_Live_Data_Questions_Email_Draft.md`), aur maangna ulta nuksaan hota:
jo restriction aaj nahi hai, use invite kar rahe hote.

### 422 live applications se jo pata chala

| Cheez | Guide kehta hai | Asliyat |
|---|---|---|
| Ek mahine ki range limit | maximum ek mahina | **enforce nahi hoti** — 120 din pe 422 record aaye |
| `isRejected` flag | rejected filter | **inert** — true aur false ne bilkul wahi 134 record diye (Id se match) |
| Status codes | enumeration nahi di | **saare 422 record pe Status 50, PaymentStatus 50, BidStatus 0, CongestionStatus 0** |
| Date formats | — | `FromDate/ToDate` = DD/MM/YYYY; `CreatedOn` ISO microseconds ke saath; MWH integer |

**Aur sabse zaroori baat:** chaar mahine ke 422 record mein **har ek** ke paas
ApprovalNo hai, ApprovedMWH > 0 hai, ScheduledMWH > 0 hai. Yaani ye report
**sirf approved applications** deti hai (ya SJVN ka 4 mahine mein ek bhi pending/
rejected nahi tha, jo mushkil hai). Iska matlab: is feed se hum **pending ya
rejected application pakad hi nahi sakte** — reconciliation ko "NOAR kya kehta hai
approved ke baare mein" hi rehna chahiye, "humne jo file kiya uska status" nahi.
Yahi wajah hai ki numeric codes ka matlab bhi nahi nikal sakta — live data mein
variance hi nahi hai.

### Code/config mein utaar diya

- `noarTraderService.js` ke doc comment mein chaaron measured fact + "approved-only"
  wali baat, taaki koi is feed pe pending-detection na bana de.
- `MAX_RANGE_DAYS` ka comment: limit enforce nahi hoti, par 31-din chunking rakhi
  hai — jo aaj police nahi karte wo kal kar sakte hain.
- `backend/.env`: **`NOAR_API_ENABLED=true`** (aaj se kaam kar raha hai),
  `NOAR_API_ENV=PRODUCTION`. Test pe jaane ka faayda nahi — wahan 401 hai.
- Jo fields NOAR bhejta hai par hum map nahi karte, ab pata hai:
  `GrossPayableAmount`, `Paid_Tds_Amount`, `Payment_Due_Date`, `ChargeDetails`
  (ChargeType / PayableAmount / PaidPrincipalTds / DueDate), `ApplicationDate`,
  `AcceptanceDate`, `ApplicationType`. Ye settlement ke kaam ki cheezein hain —
  alag piece of work.

## WBES ke liye whitelisting — ab bhi pehle ye

Credentials mil gaye par **gateway ko hamara IP pata nahi hai**, aur ye Power
Trading nahi kar sakta — dono guides gateway pe hi bolte hain:

- NOAR Trader guide §1.5: *"IP Whitelisting: Mutual whitelisting of IP should be
  done between both communication network to make communication safe."*
- WBES guide §2: *"IP Whitelisting: Whitelisting of IP will be done at gateway
  level."*

To do mail Grid India ko jaayenge (Power Trading cc mein, kyunki access unka hai;
pehle hum unka reply wait kar rahe the, wo 28-Sep ko aa gaya):

| Mail | Kisko | Kya maangta hai |
|---|---|---|
| `docs/NOAR_IP_Whitelisting_Email_Draft.md` | noar@grid-india.in (+ PwC, Dutta ji, Power Trading) | 49.50.97.173 whitelist; key prod ka hai ya test ka; mutual whitelisting mein hamari taraf kuch chahiye ya nahi |
| `docs/WBES_IP_Whitelisting_Email_Draft.md` | anupamkumar@grid-india.in (+ Power Trading) | 49.50.97.173 whitelist; **aur wahi teen cheez** — base URL, username, utility acronym (Grid India ne hi key issue ki hai, to jawab unke paas hai) |
| `docs/PowerTrading_Credentials_Acknowledgement_Email_Draft.md` | Power Trading | sirf acknowledge + endorsement, aur "is key ko koi aur system use kar raha hai kya" |

Kisi bhi mail mein key ya secret quote nahi karna — NOAR ka key mail mein sirf
"16-May-2026 ko issue hua, login SJVN Limited" se pehchana gaya hai.

## Agla kadam

1. **Probe ek baar abhi chala do** — sirf outbound IP padhne ke liye. NOAR ki
   saari call refuse hongi (expected), par jo IP wo print karega wahi gateway ko
   dikhega, aur whitelisting maangne se pehle uska confirm hona zaroori hai —
   deploy Cyfuture NAT ke peechhe hai, server ka apna address jawab nahi hai.
2. **Do whitelisting mail bhej do** (upar wali table).
3. **Confirmation ke baad asli run** — wahi run chaar sawaal settle karega: key
   prod ka hai ya test ka, range limit real hai ya nahi, refusal kaisa dikhta hai,
   aur Status/BidStatus ke asli code — jo PwC se enumeration maangne ka evidence
   banega (`docs/NOAR_Trader_API_Clarifications_Email_Draft.md` point 7 ke saath).
4. Capture aane ke baad `NOAR_API_ENV` fix karna aur server ke `backend\.env`
   mein `NOAR_API_ENABLED=true`.
