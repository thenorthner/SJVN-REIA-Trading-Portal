# REIA Portal — jo bacha hai (11 Sep 2026)

**Kahan se nikali:** `CP-53-57 REIA Workflow.pdf`, `CP - 58-61 REIA Dashboard.pdf`,
`CP -11-43 Final Scope by Committee.pdf` (3A ke A–N, 3C, 3D, section 4–6),
`PROGRESS_REPORT.md`, Delhi checklist — aur har point code, tests aur dev DB se
cross-check kiya.

**Pehle achhi khabar:**

- REIA, Seller aur Buyer portal ki **30 screens sab API se chalti hain** — koi
  mock ya hardcoded data nahi.
- Team ka apna coverage map `backend/tests/reia/` — **27 files (S1–S27)** scope
  ke hisaab se, sab pass, ek bhi `todo`/`skip` nahi.
- Scope 3A ka functional hissa zyaadatar bana hua hai: onboarding, contracts +
  amendments/versions, PPA→PSA allocation, energy data provisional/final + freeze,
  REA parse/auto-scan, billing (provisional / final / supplementary; DAILY /
  WEEKLY / MONTHLY / CUSTOM cycle), seller invoice ka system-generated se milan,
  multi-level approval + SoD, payment security (LC/BG, EMD/PBG subtype, PSF),
  LPS/rebate, disputes, reconciliation, CUF penalty, masters (entities, contracts,
  projects, banks, regulatory, billing params), consolidated management dashboard
  (3C), CERC Form-IV.
- `Final Scope by Committee` ki **teeno copies byte-by-byte ek hi file hain**
  (same md5) — Delhi checklist ka C15 sawal ("kaunsi latest?") khatam.

To REIA mein jo bacha hai wo zyaadatar teen jagah hai: **bahar ke systems se
judna** (SAP, DSC/e-invoice, SMS), **CP-58-61 ke dashboards aur reports**, aur
**section 4 ki security/infra**.

🔴 = go-live blocker · 🟠 = scope mein hai, bana nahi / adhoora · 🟡 = cleanup ·
✅ = ho gaya

> **Update, 11 Sep raat:** #8, #9, #22, #23, #24 fix. #16 aadha — warning aur
> docs ho gaye, doosri disk server pe set karni baaki. Kaam karte hue ek security
> gap mila aur band kiya — #26.

---

## A. Integrations — bahar ke system / credentials pe atke

| # | Kya | Scope ref | Haalat |
|---|-----|-----------|--------|
| 1 🔴 | **SAP real-time integration** | 3D; workflow ke "Internal approval in SAP/ERP" aur "SAP invoice processing" | Code mein sirf `sap_*` naam ke columns hain — SAP se koi connection nahi. SJVN IT se interface ka tareeka (API / RFC / IDoc), test system aur access chahiye. |
| 2 🔴 | **Digital signature (DSC) + e-invoicing (GST IRN)** | §3, 4.2, 4.4, deliverables mein baar-baar | Na IRN / ack no. / signed QR ka column, na PDF pe DSC signing. GSP/IRP access aur DSC (USB token ya HSM) ka faisla chahiye. |
| 3 🟠 | **SMS** | G, L | TextGuru ka code ready hai, par `sms_enabled=false` aur API key / sender id khaali — har SMS `outbox/` mein likha jaata hai, jaata nahi. Credentials + TRAI DLT pe sender id aur templates registered chahiye. |
| 4 🟠 | **Email, server pe** | G | `mailService` ready; local `.env` mein SMTP set hai, DB param `smtp_host` khaali. Deploy server pe SJVN ka SMTP relay confirm karna — ab MIS pack (#8) bhi isi pe jaata hai. |
| 5 🟠 | **SEA / RLDC / SLDC / JMR feed** | D | REA ka parse + auto-scan hai; baaki sources ka koi feed ya route nahi. |
| 6 🟠 | **Bank / virtual-account collection** | 4.4, assumptions | Kisi bank ka API integration code mein nahi mila. |

## B. Scope mein hai, bana nahi / adhoora

| # | Kya | Scope ref | Haalat |
|---|-----|-----------|--------|
| 7 🟡 | **CP-58-61 ke dashboards** | CP-58-61, M | **§1 ke missing KPI 14 Sep ko jud gaye:** LPS recovered / recoverable (jisme wo hissa alag dikhta hai jo overdue bills par ban chuka hai par kisi invoice par charge hi nahi hua), developer vs buyer pending alag-alag (bill count + overdue count ke saath), aur CERC Form-IV ki haalat (latest period + status, pending, past due, margin breach). Saath mein **outstanding ageing** table (not due / 1-30 / 31-60 / 61-90 / 90+), dono taraf ka, aur uska total receivable/payable KPI se match karta hai — ek hi `OUTSTANDING_SQL` par. Ageing + LPS `services/outstanding.js` aur naya `services/lpsPosition.js` mein; LPS wahi helper use karta hai jo invoice screen karti hai (contract ka rate, grace days, MoP ke escalating step, payer ke state ke working days), to bill aur dashboard ka number alag nahi ho sakta. **§2–13 ke views:** payment monitoring (delay days + LPS), developer payments aur outstanding ageing — teeno ek hi sawaal the, **14 Sep ko ek screen ban gayi** (`/reia/payment-monitoring`): dono taraf ka outstanding, kitne din late, har bill par surcharge (billed aur jo ban chuka par bill nahi hua), counterparty-wise rollup aur ageing — sab wahi services jo dashboard use karta hai. **MIS summary** ab net cash flow (collected − paid out) aur payment security held/available/expiring bhi dikhati hai. **Monthly generation (CUF/availability)** bhi ban gayi (`/reia/generation-performance`): har project ka mahina-war energy, commissioned capacity se nikla CUF, contract ka required CUF, shortfall MWh aur availability — project-wise rollup ke saath (kaun kitne mahine se peeche hai). FINAL reading provisional ko replace karti hai, dobara nahi ginti. **Abhi bhi baki:** technical & commercial verification, CERC compliance (monthly/annual), PPA/PSA timeline compliance. Data zyaadatar backend mein hai — screens banani hain. |
| 8 ✅ | **Scheduled MIS distribution** | M, 3C | **Fix, 11 Sep.** Pehle cron hardcoded `management@sjvn.local` ko bina report ek text mail bhejta tha aur "completed successfully" likhta tha. Ab `services/misDistribution.js`: EXECUTIVE group ke active users (jinka email hai) ko MIS report + REIA dashboard ke PDF attach karke. Koi recipient na ho ya send fail ho to log wahi kehta hai; har distribution audit mein. |
| 9 ✅ | **Invoice access log** | G | **Fix, 11 Sep.** Buyer/seller ka invoice kholna (`VIEW_INVOICE`) aur kisi ka bhi PDF download (`DOWNLOAD_INVOICE_PDF`) audit mein jaata hai. SJVN desk ko invoice detail mein **Access History** dikhti hai (kisne, kab, khola ya download kiya); counterparty ko nahi. Desk ke apne views record nahi hote, taaki asli entries dab na jaayein. |
| 10 ✅ | **Contract bulk upload** (template, EMD/PBG ke saath) | B | **Fix, 14 Sep.** Loader pehle se tha par uske aas-paas kuch nahi tha: ab `GET /contracts/bulk-template` (CSV, PPA aur PSA dono ki example row), `dry_run` jo likhne se pehle batata hai kya hoga, aur wahi checks jo form route lagata hai — counterparty maujood hai ya nahi, APPROVED hai ya onboarding mein, seller ki jagah buyer nahi, PPA ko seller chahiye / PSA ko buyer, contract_no duplicate (file mein ya DB mein), tenure ulti nahi, date format, billing_cycle enum, aur jo column loader nahi padhta uska naam saaf bolta hai. Frontend par **Load from Spreadsheet**: template download → paste ya file → check (preview + line-wise errors) → load. Row DRAFT hi aati hai (live jaane ka raasta status route hai). 13 backend + 15 frontend test. |
| 11 ✅ | **Seller invoice: template upload + API** | F | **Fix, 14 Sep.** `GET /invoices/upload-template` (CSV) aur `POST /invoices/upload` (`dry_run` ke saath). Contract sheet mein **contract_no** se aata hai (seller ko id nahi pata), aur wahi rules lagte hain jo form par lagte hain: contract seller ka apna ho aur ACTIVE ho, billing_period YYYY-MM, invoice_type enum, har amount number aur non-negative, energy > 0, ek hi mahine ka FINAL do baar nahi (file ke andar bhi aur DB ke against bhi — SUPPLEMENTARY allowed), invoice_no already on record nahi, aur anjaan column ka naam saaf. Bill wahi jaata hai jahan form bhejta: L1 maker ka DRAFT, baaki ka SUBMITTED, aur SJVN ke apne figure se validation bhi form jaisi hoti hai. Seller screen par **Raise from a Sheet**: template → paste/file → check (preview + line-wise errors) → raise. 14 backend + 6 frontend test. |
| 12 🟠 | **Peak availability penalty** | H, J | CUF penalty hai (`cuf_penalty_per_mwh`); peak availability ka hisaab kahin nahi — FDRE / peak-power PSA ke liye chahiye hoga. |

### Faisle jo aa gaye (14 Sep)

- **Sub-user company profile edit nahi kar sakta.** Routes pehle se sirf primary
  login (`SELLER` / `BUYER`) aur REIA desk ko allow karte the; ab
  `tests/reia/s26-company-profile-edits.test.js` ise pakad kar rakhta hai — L1/L2/L3
  ko naam, capacity, bank, regulatory approval, logo aur signature sab par 403.
  REIA Entities screen ke `CAN_WRITE` se `SELLER`/`BUYER` hata diye (wo screen
  REIA-only hai, to wo entries sirf galat padhti thi).
- **Trading client ko maker/checker roles chahiye** — alag item ke roop mein PT
  list mein.
- **Push / merge** sab kaam hone ke baad.

## C. Security / infra (scope section 4–5)

| # | Kya | Scope ref | Haalat |
|---|-----|-----------|--------|
| 13 🟠 | **SSO / LDAP / Active Directory** | 4.2 | Code mein zero. Abhi password login + account lockout hai. |
| 14 🟠 | **Encryption at rest** | 4.2 | SQLite file plain hai — koi SQLCipher/encryption dependency nahi. |
| 15 🟠 | **HTTPS** | 4.2 | Deploy scripts/docs mein TLS/SSL config nahi mila (remote access Tailscale/Cloudflare tunnel se HTTPS deta hai). Office server pe confirm karna. |
| 16 🟠 | **Backup / DR / 99% availability** | 4.3, 5.5 | Ek server, ek SQLite file. Boot + nightly snapshots (14 rakhe jaate hain). **11 Sep:** snapshots DB wali disk pe hon to boot pe ek baar warning, aur `.env.example` mein `SJVN_BACKUP_DIR` samjhaya. **Baaki:** server pe doosri disk / network share mount karke `SJVN_BACKUP_DIR` set karna (server access chahiye). DR site / failover nahi. |
| 17 🟠 | **CERT-In / VAPT** | 4.2, 4.5 | Repo mein kisi VAPT ya CERT-In audit ka record nahi. Go-live se pehle karwana. |
| 18 🟡 | **Data migration** | 4.5, deliverables | Purane bills/contracts migrate karne hain ya fresh start — Delhi C17 pe atka. |

## D. Data / demo readiness

| # | Kya | Haalat |
|---|-----|--------|
| 19 🟠 | **Dev DB mein REIA ka data nahi** | Sirf 3 PPA — NJHPS aur RHPS (hydro, ACTIVE), SGEL (solar, DRAFT). **PSA 0**, PPA→PSA allocation 0, invoices 0, energy data 0, payment security 0, projects 0. 16 Aug ke DB incident ke baad transactional demo data wapas nahi aaya. Demo/UAT ke liye reseed (aapka faisla) ya asli PPA/PSA data daalna. |

## E. Hydro billing (REIA menu ke andar)

| # | Kya | Haalat |
|---|-----|--------|
| 20 🟠 | **Sirf NJHPS aur RHPS** | Dono ka tariff aur allocation bill ko paise tak reproduce karta hai; baaki stations ke contract/allocation nahi. Kaunse stations scope mein — Delhi A2. |
| 21 🟡 | **Pehla asli bill** | Dev DB mein `hydro_station_bills` = 0 — system se ek bhi bill nahi bana. Tests Aug RHPS aur June NJHPS reproduce karte hain. |
| 22 ✅ | **D2 paste mein naam** | **Fix, 11 Sep.** Exact naam na mile to letters/digits pe milaya jaata hai — "J&K" = "J & K", "Chandigarh" = "CHANDIGARH". Ek beneficiary do spelling mein diya to error; do beneficiary jo same padhe unmein guess nahi, error. |

## F. Cross-cutting

| # | Kya | Haalat |
|---|-----|--------|
| 23 ✅ | **`.alert` CSS** | **Fix, 11 Sep** (PT list #25 bhi) — HydroBilling samet saari screens ke error/warning/success message ab rang ke saath. |
| 24 ✅ | **REIA roles frontend-backend alag** | **Fix, 11 Sep.** Frontend ko backend jaisa kiya: `REIA_ADMIN` ko ab REIA menu/screens dikhti hain (API pehle se allow karti thi); trading se `IT_SUPER_ADMIN` hataya (PT list #26). `roleGroupsParity.test.js` aage drift pakdega. |
| 25 🟠 | **Branch merge** | PT list #21 — sab kaam `feat/trading-settlement-billing` pe hai, `main` mein nahi; deploy `main` se hota hai. |
| 27 ✅ | **Dashboards ka "pending" alag-alag tha** *(12 Sep)* | **Fix.** Ek hi bill par SJVN ka "receivable" 19,50,000 aur buyer ka "pending" 21,50,000 dikhta tha — farak disputed amount ka tha. Desk `total − rebate + LPS − disputed − payments` se ginta hai, counterparty dashboards seedha `billed − paid` kar rahe the. Ab buyer aur seller dono dashboards wahi formula use karte hain (`outstandingForContracts`), aur buyer dashboard `disputed_amount` bhi dikhata hai. |
| 26 ✅ | **Invoice PDF se unapproved bill leak** *(11 Sep ko mila)* | **Fix.** Detail route pe rule tha ki jo bill SJVN ne approve nahi kiya wo counterparty ka nahi — par `GET /api/invoices/:id/pdf` ye check nahi karta tha. Invoice id jaanne wala buyer DRAFT bill ka PDF le sakta tha. Ab wahan bhi 404; SJVN desk draft download kar sakta hai. |

## G. Committee se jawab chahiye (Delhi checklist section A)

Billing formula sign-off · kaunse stations scope mein · approval chain ke roles ·
energy data ka source of truth (manual/import vs SCADA/SLDC) · dashboard KPIs ka
walkthrough · invoice format (SJVN GST format ya regulator ka).

---

## Seedha agla kadam

1. **Server pe:** #16 doosri disk / share pe `SJVN_BACKUP_DIR`, #4 SMTP relay
   (MIS pack isi pe jaayega), #25 merge ke baad deploy.
2. **Bade build items:** #7 CP-58-61 dashboards, #10 contract bulk upload, #11
   seller template/API, #12 peak availability.
3. **SJVN IT / bahar se:** #1 SAP interface, #2 DSC + GSP/IRP, #3 SMS + DLT,
   #13 SSO/AD, #17 VAPT.
4. **Committee:** section G, #18 migration, #20 stations.
5. **Demo/UAT:** #19 — reseed ya asli data.
