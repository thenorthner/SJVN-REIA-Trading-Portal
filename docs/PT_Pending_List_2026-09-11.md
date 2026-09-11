# Power Trading — jo bacha hai (11 Sep 2026)

**Kahan se nikali:** scope docs (`CP -83-85 Power Trading Work flow.pdf`,
`CP - 86 Power Tradig Dashboard.pdf`), `TRADING_PLATFORM_ROADMAP.md`, teeno trading
worklogs (16 Aug, 25 Aug, 07 Sep), email drafts, aur har point code/DB mein
cross-check kiya.

**Pehle achhi khabar:** ISET ke trading menu ki **saari 131 screens ban chuki
hain** — `tradingMenu.js` mein ek bhi `pending` nahi. Roadmap ke 15 items mein se
zyaadatar code mein hain (rate master, party aliases, TDS ledger, series numbering,
purchase/sale rate split, ledger importer, deviation register, payment cycle,
contract P&L, application no.). Jo bacha hai wo mostly **bahar se blocked** hai, ya
scope ka wo hissa hai jahan paisa/grid ko asli mein chhoona padta hai.

🔴 = go-live blocker · 🟠 = scope mein hai, bana nahi / adhoora · 🟡 = cleanup ·
✅ = ho gaya

> **Update, 11 Sep shaam:** #10 aur #16 fix ho gaye. #21 aadha — uncommitted kaam
> commits mein toot gaya, merge baaki. #18 galat nikla (neeche dekho). Kaam karte
> hue teen nayi cheezein mili — #25, #26, #27.

---

## A. Bahar se blocked — humare haath mein nahi

| # | Kya | Kiske paas atka | Haalat |
|---|-----|-----------------|--------|
| 1 🔴 | **IEX live** | Deploy + IEX | Code ready aur spec ke against verified. `iex_enabled=false`, env `UAT`. Whitelisted server `49.50.97.173` pe deploy karke enable karna, phir `/api/iex/connectivity` chalana. Token 6 mahine valid bola hai — server se confirm hoga. |
| 2 🟠 | **IEX REC/EC** | IEX | REC ka token FO wala hi hai ya alag — poochna hai. REC ka **production host IEX ne blank chhoda** hai; iske bina LIVE pe REC nahi chalega. |
| 3 🔴 | **PXIL** | PXIL (Gaurav Tiwari) | Clarification draft ready (`PXIL_API_Clarifications_Email_Draft.md` + short cover). A1–A5 (URL, auth, staging/prod, IP whitelist, trailing slash) aur B1–B2 (Member DOR `Total` mismatch, Reverse Auction L1) blocking hain. Reply ke baad: staging pe read-only pull → reconciliation → prod → phir DAM/RTM. |
| 4 🔴 | **WBES API** (schedules) | Grid-India | `wbes_enabled=false`, `wbes_api_key` khaali — stub sample pe chal raha hai. Draft email mein `<UTILITY_ACRONYM>` aur naam bharna baaki hai. |
| 5 🟠 | **NOAR API** (approval status) | Grid-India / PwC | Draft ready (`NOAR_API_Email_Draft.md`). Tab tak NOAR status desk manually update karta hai. |
| 6 🔴 | **DSM slab rates** | CERC/SERC notification | DB mein **6 slabs, 0 verified, 6 bina rate ke** — yaani abhi har deviation block **unpriced** hai aur bill pe DSM charge nahi aata (warning aati hai). Notification milte hi desk `Deviation (DSM) Slabs` screen se rate daalega. Sub-bands (49.90/49.85…) bhi tabhi. |
| 7 🟠 | **Grid frequency ka auto-feed** | Live Grid API | Abhi har block ki frequency desk form se manually daalti hai. |
| 8 🟠 | **ERP push** | Target ERP ka API contract | Code mein kuch nahi hai. Contract milne tak design bhi nahi ho sakta. |

## B. Scope mein hai, code mein nahi / adhoora

| # | Kya | Scope ref | Haalat |
|---|-----|-----------|--------|
| 9 🔴 | **Exchange ko bid API se bhejna** | CP-83-85 §2 step 2 | `placeOrder()` jaan-boojh ke stub hai; LIVE pe mana karta hai. IEX FO submission, REC/EC order entry, PXIL order — teeno nahi bane. Paisa hilaane wala call hai, controlled rollout chahiye. ⚠️ Trap already note hai: submit pe qty ×10, result pe ÷100. **Aur:** `bids.js` har bid ko — PXIL wali bhi — `iexService.placeOrder` se bhejta hai; PXIL ka apna submit path nahi hai. |
| 10 ✅ | **Stub mein "Submitted to Exchange" dikhna** | — | **Fix, 11 Sep.** Bid row pe naya `submission_mode` (`STUB`/`LIVE`), purani stub rows receipt `IEX-STUB-…` se backfill. `Bids.jsx` har tab pe **"Not sent — stub"** dikhata hai (tooltip mein receipt), aur submit ke waqt alert. Lifecycle abhi bhi `SUBMITTED` se aage chalti hai. |
| 11 🟠 | **Schedule punch / LDC ko submit** | CP-83-85 §1 step 6, §2 step 5 | WBES API (#4) pe atka. Abhi schedules upload/manual entry se aate hain. |
| 12 🟠 | **IEX obligation report upload → REC ledger** | CP-83-85 §5 step 6 | Koi upload endpoint nahi. REC order/obligation figures abhi haath se daale jaate hain. |
| 13 🟠 | **REC for CSPP: JMR aur registry application tracking** | CP-83-85 §5 steps 1–3 | REC lot create + `issue` action hai, par JMR data aur NLDC registry application / documents / follow-up track karne ki jagah nahi dikhi. |
| 14 🟠 | **Power Market Dashboard live data** | CP-86 §3 | `CEAReportsDashboard.jsx` aur `PowerMarketDashboard.jsx` **hardcoded arrays** pe chalte hain (installed capacity Nov-2024 tak ruki hai). Installed capacity, peak demand vs met, energy req vs available, generation pie — sab ke liye CEA data upload/feed chahiye. "Day-wise buy vs sell vs MCP" bhi static hai. |
| 15 🟡 | **Client home dashboard** (`/trading/home`) | — | `HomeDashboard.jsx` mein `mockSummaryData` (Naitwar Mori ke sample rows) — "sample data" notice ke saath. Client ke apne obligations se jodna hai. |
| 16 ✅ | **Update Portfolio ID** | ISET screen | **Fix, 11 Sep.** Naya table `client_exchange_portfolios` + `/api/client-portfolios` (GET / PUT). Ek client ka ek exchange pe ek portfolio; ek portfolio sirf ek client ka (case-insensitive, 409). Screen ab live client list se, record ki list neeche, har change audit mein. Pehle 26 naam hardcoded the aur Save sirf `console.log` karta tha. |
| 17 🟡 | **ERP Vendor Payable Ledger** | ISET screen | Screen mein koi API call nahi mili — static ho sakti hai, check karna hai. |

CP-86 §1 (SJVN PT dashboard — energy MU, revenue, profit, REC) aur §2 ka price
part API se live hai; wo theek hai.

## C. Roadmap ke bache hue tukde

| # | Kya | Haalat |
|---|-----|--------|
| 18 ❌ | ~~CERC files git se hatana (roadmap #2)~~ | **Galat nikla.** `.gitignore` ka comment saaf kehta hai ki 16 `.xlsx` (~3 MB) **jaan-boojh ke tracked** hain — fresh deploy pe `autoSeedLocalReports` inhi se market-intelligence seed karta hai, bina internet ke. PDFs pehle se ignored hain. Kuch karna nahi. (Dhyan rahe: deploy `git reset --hard origin/main` hai, to inhe untrack karna server se delete kar deta.) |
| 19 🟡 | Mid-period revisions / multi-buyer splits | 16 Aug worklog mein jaan-boojh ke scope se bahar rakha tha. |
| 20 🟡 | Exchange contract detail pe settlement panel | "Optional polish" — billing hub primary path hai. |

## D. Committee se jawab chahiye (Delhi checklist)

Poori list `Delhi_Visit_Clarity_Checklist_2026-09-09.md` mein hai. PT wale:
PSA vs PPA engine · IEX vs PXIL mismatch pe kaun authoritative · DSM slabs ka
version · reconciliation tolerance · dispute categories · payment security policy
· NOAR SLA 70% · roles · cutover / historical data · audit retention.

(Us doc ke section B mein numbering 1 ke baad seedha 7 pe jaati hai — 2–6 missing
hain. Bhejne se pehle dekh lena: sirf numbering hai ya 5 sawal chhoot gaye.)

## E. Release / engineering

| # | Kya | Haalat |
|---|-----|--------|
| 21 🟠 | **Branch merge** | Uncommitted kaam 11 Sep ko alag commits mein toda: production hardening, Rampur/REA D2 billing, route-loading UI, docs. Hardening commit akele bhi test kiya (1110 pass). **Push / `main` mein merge abhi baaki** — deploy `origin/main` se hota hai. |
| 22 🟠 | **Test flake (~8%)** | `update.sh` test fail pe rollback karta hai, to ek sahi release bhi random rollback ho sakta hai. Lead: supertest ka request↔response pairing. |
| 23 🟠 | **Deploy** | `192.168.58.63` sirf office LAN se (`deploy_to_192.py`). IEX ke liye whitelisted `49.50.97.173` wala server chahiye. |
| 24 🟡 | Dev DB full reseed | User ka decision — bina pooche nahi chalana. |

## F. Kaam karte hue mila (11 Sep)

| # | Kya | Haalat |
|---|-----|--------|
| 25 ✅ | **`.alert` CSS kabhi bani hi nahi** | **Fix, 11 Sep.** `styles.css` mein `.alert` + error / danger / warning / success / info. Pehle HydroBilling, NOC Updation, Portfolio ID samet kai screens ke error/success message plain text dikhte the. |
| 26 ✅ | **Frontend aur backend ke role groups alag** | **Fix, 11 Sep.** Frontend ko backend jaisa kiya (API hi decide karti hai): `IT_SUPER_ADMIN` trading screens se hata (API waise bhi 403 deti thi), `REIA_ADMIN` ko REIA screens. `roleGroupsParity.test.js` aage drift pakdega. |
| 27 🟡 | **Portfolio Registry abhi mock** | `master/portfolio-registry` `MOCK_ASSETS` pe chalti hai. Ab `client_exchange_portfolios` table hai — registry ko usse joda ja sakta hai. |

---

## Seedha agla kadam

1. **Humare haath mein, jaldi:** #27 registry jodna, #21 push + merge ka faisla.
2. **Emails bhejo / follow-up karo:** #3 PXIL, #4 WBES, #5 NOAR, #2 IEX REC.
3. **Deploy pe:** #1 IEX enable + connectivity probe.
4. **Committee/Delhi:** #6 DSM rates aur section D.
5. **Bade build items:** #9 bid submission (controlled rollout), #12–13 REC flow, #14 CEA data.
