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

## Abhi bhi blocked (IEX se jawab chahiye)

Draft taiyaar hai: [IEX_API_Clarifications_Email_Draft.md](IEX_API_Clarifications_Email_Draft.md)

1. **Base URL** — kisi bhi document mein host nahi hai, sirf paths. UAT aur Live
   dono chahiye. **Iske bina ek bhi live call nahi ja sakta.**
2. **Token renewal** — jo token mila wo **1 ghante ka tha aur 26-07-2026 ko hi
   expire ho chuka hai**. Kisi document mein login/refresh endpoint nahi hai,
   par CnS mein `CNSAPI-509 Token is expired` error defined hai. Fresh token +
   renewal process chahiye.
3. **Delivery date IST hai ya UTC midnight** — abhi exchange se hi poochh ke
   kaam chala rahe hain.
4. **Schedule report ke decimals** — Trade wale ya Order wale? Spec chup hai.
5. **REC / ESCerts ke FO API documents** — mile hi nahi, isliye implement nahi
   kiye. Status API saaf `NOT_IMPLEMENTED` bolta hai.
6. **iDAM** — DAM 2.2 document hi serve karta hai ya alag doc hai? G-DAM
   included hai ya nahi?

---

## Verify kaise kiya

```bash
npm test --prefix backend        # 61 files, 1035 tests — sab pass
```

`/trading/iex` browser mein chala ke dekha: status cards, connectivity probe
(sahi se "Not reachable" bola), teeno tabs, koi console error nahi.
