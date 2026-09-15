# Bacha hua kaam — ek list (15 Sep 2026)

**Kahan se nikali:** `PT_Pending_List_2026-09-11.md`, `REIA_Pending_List_2026-09-11.md`,
aur poore code ki jaanch — `Math.random` / hardcoded arrays wali screens, boot par chalne
wale seed, TODO/"for demo" comments — plus Market Forecasting banate hue jo mila.

Do hisse: **A** jo humare haath mein hai aur ek-ek karke nipta rahe hain, **B** jo
bahar se ya faisle par atka hai (sirf yaad rakhne ke liye).

🔴 = paisa / go-live par asar · 🟠 = screen asli data nahi dikhati ya scope adhoora ·
🟡 = cleanup · ✅ = ho gaya

---

## A. Humare haath mein — isi kram mein

| # | Kya | Kyun zaroori | Haalat |
|---|-----|--------------|--------|
| 1 ✅ | **DSM ka reference price (DAM ACP) nakli rows se** | `getReferencePrice('DAM_ACP')` us din ki **har** DAM row ka average leta hai — demo seed ki `IEX_PORTAL` rows, PXIL, HPX sab. Yaani DSM charge bill par seed ke banaaye price se ban sakta hai. | **Ho gaya.** Ab sirf asli price (price file / IEX API / CERC). Deviation jis block mein hua, **usi block** ka price — jitne exchange ke paas wo block hai, cleared volume se weighted; block na ho to din ka. Bilateral actuals aur DSM preview dono block bhejte hain. Asli price na ho to block unpriced (pehle jaisa). DSM notification aane par basis ek baar match karna. 4 test. |
| 2 ✅ | **Server boot par registers mein sample records** | `seedExchangeApplications`, `seedRecOrders` (10 nakli REC order, buyer "State DISCOM", invoice `REC/INV/…`), `seedPxilOrders` — har boot par table khaali ho to likh dete hain, **production par bhi**. `seedBilateralContractSummary` live LOA number par har contract ko 25 MW, ₹4.00/₹4.03 ka ACTIVE bana deta hai. | **Ho gaya.** Teeno inline seed hata diye — fresh install par register khaali, jo sach hai. Bilateral wala seed (sirf dev machine, `data/live/` se) ab quantum/tariff 0 aur rates NULL rakhta hai (pehle 25 MW @ ₹4.03, aur report wale rows mein sale rate = margin ₹0.03), aur jiska maana hua saal beet gaya use COMPLETED. **Dev DB ki purani seed rows nahi chhedi** — reseed aapka faisla. |
| 3 🔴 | **Netting "simplified for demo"** | `/billing-settlement/netting` client ke ledger mein seedha SET_OFF likhta hai — kisi invoice se nahi judta, amount body se aata hai. | |
| 4 🟠 | **Market Rates & Analytics ka Intraday tab** | Poora `Math.random` (96 block, har reload par alag), "Auto-Route to GDAM" button kuch nahi karta. Ab block-wise asli prices hain (price file / IEX API). | |
| 5 🟠 | **Market analytics backend demo rows padhta hai** | `/api/market-analytics/*` (trend, summary, blocks, alerts) aur MIS PDF `market_rates` ki seed rows bhi ginte hain. | |
| 6 🟠 | **DAM/GDAM "Market MCP" — Bid vs Cleared chart** | `BidVsClearedAnalytics` random data banata hai; bid book database mein pada hai. | |
| 7 🟠 | **Collective / Macro / Power Market / MMR widgets hardcoded** | DAM/GDAM/RTM price-volume, REC, PXIL/HPX volume, short-term vs DSM — ye sab CERC monthly report se `cerc_market_data` mein pehle se hai (16 mahine). MMR Dashboard saalana figure ko ek "seasonal weight" se mahino mein baant ke mahine ka number **banata** hai. | |
| 8 🟠 | **GTAM / TAM widgets mein "State2 … State20"** | Placeholder naam asli figure ki tarah dikhte hain; platform ke paas iska koi source nahi. | |
| 9 🟠 | **CEA dashboards hardcoded** (PT #14) | Installed capacity Nov-2024 par ruki, generation mix, peak demand — koi upload/feed nahi. | |
| 10 🟠 | **IEX obligation report upload → REC ledger** (PT #12) | REC obligation figure haath se daalte hain. | |
| 11 🟠 | **REC for CSPP: JMR + registry application tracking** (PT #13) | Lot create + issue hai, JMR aur NLDC registry application/documents/follow-up ki jagah nahi. | |
| 12 🟠 | **JMR / SEA energy data upload** (REIA #5) | Sirf REA parse hai; baaki sources ka route nahi. | |
| 13 🟡 | **ERP Vendor Payable Ledger** (PT #17) | Screen mein API call nahi mili — static ho sakti hai. | |
| 14 🟡 | **Exchange contract detail par settlement panel** (PT #20) | Billing hub primary path hai; contract se settlement dikhna chahiye. | |
| 15 🟡 | **Top 10 GDAM participants chart** | Data array component mein likha hai — source check. | |
| 16 🟡 | **Test flake** (PT #22) | ~15 parallel run mein 1; lead: supertest ka ephemeral port reuse. | |
| 17 🟡 | **Mid-period revisions / multi-buyer splits** (PT #19) | Aug mein jaan-boojh ke scope se bahar rakha tha — design chahiye, sabse aakhir mein. | |

## B. Bahar se ya faisle par atka (abhi kuch nahi kar sakte)

- **Exchanges / grid:** IEX live + connectivity (whitelisted server `49.50.97.173`), IEX REC production host, PXIL clarifications, WBES API key, NOAR API, grid frequency feed, exchange ko bid bhejna (paisa hilaane wala — controlled rollout ka faisla).
- **Regulator:** DSM slab rates (0 verified), ceiling revision aane par `market_price_cap`.
- **SJVN IT / infra:** SAP interface, DSC + e-invoice (GSP/IRP), SMS DLT registration, SMTP relay on server, SSO/AD, encryption at rest, HTTPS confirm, backup ke liye doosri disk (`SJVN_BACKUP_DIR`), VAPT / CERT-In, bank collection API, ERP push contract.
- **Committee / aapka faisla:** billing formula sign-off, hydro stations scope, data migration, dev DB reseed, forecasting model + accuracy expectations, forecast trading clients ko dikhana ya nahi, branch merge + deploy.
