# Worklog — 07 Sep 2026
## IEX Front Office API — spec ke against sahi implementation

**Branch:** `feat/trading-settlement-billing`
**Trigger:** IEX (Sandeep Kumar, Market Operations) ne 04-09-2026 ko UAT credentials
bheje — participant `N2DL0SJV0000` / SJVN Limited, user `SJVA1`, segments iDAM,
HPDAM, RTM & REC, IP `49.50.97.173` whitelisted.

---

## Problem

`services/iexService.js` pehle se maujood tha, par wo **kabhi live exchange ke
against chala hi nahi tha**. Credentials aane ke baad jab specs
(`docs/Technical Document for FO API/` — DAM 2.2, GDAM 2.0, HPDAM 2.0, RTM 2.0)
se line-by-line milaya, to code ke andar paanch aise bugs mile jo **error nahi
dete — bas galat number dete hain**. Yahi khatarnak hai: settlement mein chala
jaata aur kisi ko pata nahi chalta.

| # | Kya galat tha | Asar |
|---|---------------|------|
| 1 | `10 ** decimals` se unscale kar raha tha | Spec kehta hai decimal value **khud divisor hai** ("1 : 0 Decimal Place, 10 : 1, 100 : 2"). Yaani 2-decimal asset pe code `10^100` se divide karta. |
| 2 | Asset Master se `OrderQuantityDecimal` padh raha tha | Spec mein field ka naam `OrderQtyDecimal` hai. Kabhi milta hi nahi → factor 0 → phir #1 ke saath mila ke aur bigadta. |
| 3 | `DeliveryDate` mein ISO string (`2026-09-08`) bhej raha tha | Spec: "Value in seconds from 01-01-1970" — epoch seconds chahiye. |
| 4 | Schedule report URL mein 3 params bhej raha tha | Spec 5 maangta hai: `{LoginUserId},{ParticipantId},{DeliveryDate},{BidAreaId},{PortfolioId}`. |
| 5 | **Cleared MW ke liye `AreaSellQty` / `AreaBuyQty` padh raha tha** | Ye **poore bid area** ka volume hai, SJVN ka nahi. Hamara apna quantity teen level neeche hai: `ReportDetails[] → PeriodDetails[] → ScheduleDetails[].Quantity`. Iske bina har settlement figure market-size ka aata. |

Response nesting bhi galat thi — code top level pe
`PeriodWiseScheduleReportDetails` dhoondh raha tha, jo response mein hai hi nahi.

---

## Kya banaya

### 1. `services/iexService.js` — poora rewrite spec ke against

- **Scaling** — `unscale(raw, factor)`: factor hi divisor hai. Missing/0/negative
  factor pe 1 se divide, kabhi `10^100` se nahi. Har response ab bataata hai
  usne kaun sa factor lagaya (`scaling: { qty_factor, price_factor, source }`) —
  galat assumption dikh jaaye, chupe nahi.
- **Decimals** — `OrderQtyDecimal` / `OrderPriceDecimal` / `TradeQtyDecimal` /
  `TradePriceDecimal`. Cache sirf success pe, failure pe nahi (warna process
  poori zindagi ek kharab factor pe atak jaata).
- **Delivery date** — `resolveDeliveryDate()` pehle exchange ki apni
  `deliverydates` API se epoch **poochta** hai. IST-midnight calculation sirf
  fallback hai, aur response mein `delivery_date_source: EXCHANGE | COMPUTED`
  saaf likha jaata hai. Spec nahi batati ki seconds kis midnight se hain — 5.5
  ghante ka farak matlab galat trading day.
- **Schedule report** — teeno level unnest, `ScheduleDetails[].Quantity` ka sum
  = hamara cleared MW. Area ka volume alag columns (`area_buy_mw`,
  `area_sell_mw`) mein rehta hai taaki dono kabhi confuse na hon.
- **PQ results** — `BidAreaDetails` mein se **configured** bid area, na ki jo
  exchange pehle list kare. `ALL` pe saare areas.
- **Token expiry** — issued JWT ka `exp` padh ke rakha jaata hai. Expired token
  pe request **bheji hi nahi jaati**; error saaf kehta hai kab expire hua.
  Warna 401 ki deewar milti jo exchange down hone jaisi dikhti hai.
- **Timeout** — 40s, jaisa spec har API ke liye fix karta hai.
- Bid submission **jaan-boojh ke stub hi hai**. Do-tarfa, paisa hilaane wala
  call hai; live config pe ye refuse karta hai, pretend nahi karta.

### 2. `routes/iex.js` + `/api/iex` — read-only HTTP surface

| Route | Kaam |
|-------|------|
| `GET /status` | Live hai ya stub, token kab marega, kaun se segment implemented nahi. Token kabhi return nahi hota. |
| `GET /connectivity` | Ek round trip `businessconfig` pe. IP whitelist hone ke baad **yahi chalana hai** — ye "galat URL / kharab token / IP block" ko "aaj report khaali hai" se alag karta hai. |
| `GET /decimals` | Kaun se factor lag rahe hain. |
| `GET /delivery-dates` | Exchange kaun si dates trade kar raha hai + epoch values. |
| `GET /pq-results` | Market clearing price/quantity. |
| `GET /schedule-report` | Hamara apna cleared schedule. |

### 3. Frontend — `/trading/iex` ("IEX Integration (API)")

Menu mein naya **IEX** group. Screen teen cheezein chhupati nahi:
STUB vs live, token ki expiry ghadi, aur har figure ke peeche ka scaling factor
+ delivery-date source.

### 4. Config

`.env` (gitignored) mein UAT credentials, `.env.example` mein placeholders,
masters mein `iex_bid_area_id` / `iex_portfolio_id` / `iex_environment` add.
Token masters se rotate ho sakta hai — redeploy ki zaroorat nahi.

### 5. Tests — 37 naye

`tests/iexService.test.js` (27) + `tests/iexApi.test.js` (10). Har test upar
wali table ke ek bug se mapped hai — kyunki inme se koi bhi galti **exception
nahi phenkti**, sirf believable-lekin-galat number deti hai.

---

## IEX ke jawab (08-09-2026) — aur unse kya badla

Sandeep ne saare 6 sawaalon ka jawab de diya. Do jawab ne implementation **galat
sabit ki**, ek ne architecture badla:

### 1. Base URL — ek nahi, **har segment ka apna host**

Ye assumption hi galat thi ki ek base URL hoga. Actual:

| Segment | UAT (Alpha) | Live |
|---------|-------------|------|
| DAM / GDAM (iDAM) | `alphaidamapi.iexindia.com` | `idamapi.iexindia.com` |
| HPDAM | `alphahpdamapi.iexindia.com` | `hpdamapi.iexindia.com` |
| RTM | `alphartmapi.iexindia.com` | `rtmapi.iexindia.com` |
| REC | `alpharecapi.iexindia.com` | *(IEX ne blank chhoda)* |
| C&S BO (post-trade) | `alphawebportal.iexindia.com` | `energx.iexindia.com` |

Path grammar wahi rehti hai — IEX ka apna example:
`GET https://alphaidamapi.iexindia.com/dam/api/v2/deliverydates/USER,PARTICIPANT`

`PRODUCT_HOSTS` table client mein build-in hai, `iex_environment` (UAT/LIVE) se
switch hota hai. Ab `iex_base_url` set karne ki zaroorat **nahi** — wo sirf
override hai (mock ke liye). Saare 9 host DNS pe resolve karte hain, verify kiya.

### 2. Delivery date — **UTC midnight, IST nahi** ❌ mera fallback galat tha

IEX ka example: T+1 → `1788912000`. Ye exactly 20705 poore din hai epoch se
(86400 se exactly divisible), yaani **2026-09-09T00:00:00Z**. IST midnight hota
to `1788892200` aata. Mera `istMidnightEpoch()` 5.5 ghante peeche tha — galat
trading day address karta.

Ab `utcMidnightEpoch()` hai. (Exchange ki apni value ko prefer karna wala logic
pehle se sahi tha, aur IEX ne bhi yahi bola: "use the values returned by the
respective APIs without any modification or recalculation".)

### 3. Token — 6 mahine, aur jo bheja tha uski expiry **typo thi**

Sandeep: *"Ignore the date mentioned, it was typo. Validity of the token is 6
Month."* Login/refresh endpoint hai hi nahi; expiry se 15 din pehle mail pe naya
token aa jaayega.

Iska matlab mera hard block **galat** ho gaya — agar `exp` claim pe request rok
denge to kuch chalega hi nahi. Ab: **warn karta hai, bhejta hai**, aur warning
response ke saath travel karti hai (taaki 401 aaye to turant samajh aaye kyun).
`iex_enforce_token_expiry=true` se purana sakht behaviour wapas aa jaata hai.

### 4. Decimals — trade wale, confirm ho gaya

*"The same scaling factors used for trade-related quantity and price fields may
be applied"* + *"Quantity or Price must be divided by 100"*. Code pehle se
`tradeQty`/`tradePrice` use kar raha tha — sahi tha, ab comment mein confirm.

⚠️ **Ek trap note kar liya:** submit side aur result side ke factor **alag**
hain — *"while submitting bid order Quantity (MW) X 10, eg 5.3 mw -> 53"* par
result padhte waqt ÷100. Ye silent 10x error hai. Abhi submission live nahi hai,
par comment mein warning chhod di hai.

### 5. REC / ESCerts — **document mil gaya, client ban gaya**

Pehle attachment nahi pahuncha tha; baad mein
`IEX_REC  EC_API_1.0_29June2026.pdf` mila. Ek hi document **REC aur EC (ESCerts)
dono** cover karta hai — segments URL se nahi, **`Product` symbol se** alag hote
hain. Doc repo mein import kar diya.

`services/iexRecService.js` alag module hai, aur jaan-boojh ke — wire contract
hi alag hai:

| | FO API (DAM/RTM/…) | REC/EC API |
|---|---|---|
| User header | `UserId` | **`LoginUserId`** |
| Token header | `Authentication` | **`Authorization`** |
| Decimals kahan se | Asset Master (`OrderQtyDecimal`) | **Product Master** (`PriceDecimalLocator`, `QtyDecimalLocator`) |
| Model | time blocks + delivery date | **order book + trade book**, clock time se filter |
| Price unit | Rs/MWh → Rs/kWh convert | **Rs per certificate — convert NAHI karna** |

Wo pehla row sabse khatarnak hai: FO wale headers reuse karte to seedha **401**
aata aur kuch batata bhi nahi. Isliye headers alag likhe, share nahi kiye.
Price unit wala bhi trap hai — certificate price ko /1000 karte to Rs 1000 ka
REC **Rs 1.00** dikhta.

**Implemented (read-only):** product master, order book, trade book,
business config / connectivity.
**Implemented nahi:** order entry / modify / cancel — paisa hilaane wale calls
hain, FO bid submission jaisa hi rule.

Ek aur baat: REC ka **production host IEX ne blank chhoda** hai, sirf UAT diya.
Client guess nahi karta — LIVE pe REC maango to saaf mana kar deta hai.

**Token:** confirm nahi hai ki REC/EC ka token FO wala hi hai ya alag. Jo token
mila usme claim `system: TradeV2Api` hai. `iex_rec_api_token` override rakh diya
hai, blank ho to `iex_api_token` use hota hai.

### 6. Scope confirm

UAT mein enabled: **DAM (iDAM), GDAM, HPDAM, RTM, REC**. iDAM ke liye DAM 2.2
document hi valid hai, alag doc nahi. G-DAM bhi included hai.

Sandeep ne dobara yaad dilaya: **saare requests `49.50.97.173` se hi jaane
chahiye**, warna process nahi honge. Isliye maine is Mac se koi authenticated
call **nahi** ki — sirf DNS check kiya. Asli connectivity probe deploy ke baad
server se chalega.

---

## Ab kya pending hai

1. **Fresh token** — `.env` wala purana hai. Sandeep ne 6-month validity boli hai
   to shayad chalega; confirm server se `/api/iex/connectivity` chala ke hoga.
2. **`IEX_ENABLED=true`** karna — abhi `false`. Whitelisted server pe deploy
   karke enable karna, phir connectivity test.
3. **REC token confirm** — FO wala shared hai ya alag, IEX se poochna.
4. **REC production host** — IEX ne blank chhoda, live jaane se pehle chahiye.

---

## Testing — dhang se

### 1. Wire-level tests (`tests/iexWire.test.js`, 20 tests)

Mocked `fetch` sirf mapping prove karta hai, **wire nahi**. Ek header jo actually
transmit hi nahi hota, ya galat assemble hui URL, ya abort jo fire hi nahi hota —
mock ke saamne sab pass dikhte hain. Isliye **asli HTTP server** khada karke dono
client uske against chalaye, aur assert kiya ki server ko *sach mein kya mila*.

Isse teen asli cheezein pakdi gayin:

**(a) Timeout kabhi fire hi nahi hota tha (test-verified nahi tha).**
`REQUEST_TIMEOUT_MS` module-load pe freeze ho jaata tha. Ab per-request padha
jaata hai, aur `iex_timeout_ms` masters param se bhi (pehle maine param document
kar diya tha jo kuch karta hi nahi tha — wo bhi fix). Ab hanging server pe
sach mein abort hota hai: test file 30s se **670ms** pe aa gayi.

**(b) 403 ka error message bekaar tha.** Desk ko ye dikhta tha:
```
IEX HTTP 403: <!DOCTYPE html><html><head><title>403 Forbidden</title>...
```
Jabki 403 is integration ka **sabse expected** failure hai (IP whitelist). Ab:
```
IEX HTTP 403 (403 Forbidden) — most likely this host is not whitelisted for the
calling IP. IEX only serves requests from the IP registered with them.
```
401 ka bhi ("the token was rejected").

**(c) Dono clients ek hi process mein alag headers bhejte hain** — verify kiya
ki FO call pe `Authentication`/`UserId` jaata hai aur REC pe
`Authorization`/`LoginUserId`, aur ek dusre mein leak nahi hote.

### 2. Live probe — IEX UAT ke against

Chaaron UAT host: **TLS valid**, aur **HTTP 403** wapas. 403 IP whitelist block
hai — is Mac se aage jaana possible hi nahi, token bhejein ya na bhejein.
Isliye **asli token kabhi nahi bheja**; probe ek dummy token se chalaya, sirf ye
dekhne ke liye ki client asli network path pe theek behave karta hai. Karta hai —
sahi host resolve kiya, real HTTPS, 403 clean report, koi crash nahi.

Asli authenticated probe deploy ke baad `49.50.97.173` se hi chalega.

### 3. Suite

```
npm test --prefix backend        # 63 files, 1103 tests — 3/3 runs green
npm run build --prefix frontend  # clean
```
IEX ke apne **83 tests** 5 consecutive runs stable.

Browser mein `/trading/iex`: host card product ke saath badalta hai
(DAM → `alphaidamapi`, RTM → `alphartmapi`), REC/EC ke dono tabs 200 dete hain
aur "Price (Rs/certificate)" column dikhate hain, token-expiry banner sahi bolta
hai, koi console error nahi.

---

## Ab kya pending hai

1. **Fresh token** — `.env` wala purana hai. 6-month validity ki baat hai to
   shayad chalega; confirm server se `/api/iex/connectivity` chala ke hoga.
2. **`IEX_ENABLED=true`** — abhi `false`. Whitelisted server pe deploy karke enable.
3. **REC token confirm** — FO wala shared hai ya alag, IEX se poochna.
4. **REC production host** — IEX ne blank chhoda.

---

> ⚠️ **`tests/hydroBillingApi.test.js` ke baare mein — ye IEX ka kaam nahi hai.**
> Ek point pe wo 15/15 fail kar raha tha, ab pass karta hai; wajah main
> explain nahi kar sakta (file mtime nahi badla beech mein).
> **Jo definitively prove ho gaya:** clean worktree mein HEAD + sirf hydro wale
> uncommitted changes (mera koi code nahi) daal ke chalaya to **2 test fail**
> hue. Yaani ye failure us session ke work-in-progress se aata hai, mere IEX
> changes se nahi. Us session ko khud dekhna padega.
