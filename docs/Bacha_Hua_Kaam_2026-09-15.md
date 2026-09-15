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
| 3 ✅ | **Netting "simplified for demo"** | `/billing-settlement/netting` client ke ledger mein seedha SET_OFF likhta hai — kisi invoice se nahi judta, amount body se aata hai. | **Ho gaya.** Pehle net receivable ko **naye debit** ki tarah likhta tha — jo bill pehle se debit the unpar dobara, yaani client wahi paisa do baar owe karta. Ab dono taraf records se: client ke **issued, unpaid** bills (draft nahi) aur uske **Seller exchange contracts** ka us mahine ka proceeds minus margin. Chhota wala set-off hota hai — bills par purane pehle `SET_OFF` payment (PAID / PARTIALLY_PAID), aur ledger mein utna credit (sirf un bills ka jo ledger par hain). Ek mahina ek hi baar (409). Kuch set-off karne ko na ho to 422, kuch nahi likhta. Dialog mein typed amount ki jagah preview: kaunse bill, kaunsa contract, set-off ke baad kiska kitna bacha. **Bilateral seller proceeds shaamil nahi** — bilateral transaction yeh record nahi karta ki client kis side hai; preview ye saaf bolta hai. 6 backend + 5 frontend test. |
| 4 ✅ | **Market Rates & Analytics ka Intraday tab** | Poora `Math.random` (96 block, har reload par alag), "Auto-Route to GDAM" button kuch nahi karta. Ab block-wise asli prices hain (price file / IEX API). | **Ho gaya.** Exchange + sirf wahi dates jinke block-wise prices hain; har product ka din ka price (volume-weighted) aur kahan se aaya; GDAM vs DAM ek tathya ki tarah ("GDAM N blocks mein DAM se upar"), koi routing salah nahi; 96-block MCP aur MCV chart. Kuch na ho to saaf bolta hai kahan se aata hai. "Auto-Route", Export PDF/Excel (kuch nahi karte the) aur sample notice hata diye. ACP trend widget (10 hardcoded din "N1 Region") ab asli daily price + block range. 5 frontend test. |
| 5 ✅ | **Market analytics backend demo rows padhta hai** | `/api/market-analytics/*` (trend, summary, blocks, alerts) aur MIS PDF `market_rates` ki seed rows bhi ginte hain. | **Ho gaya.** Naya `services/marketPrices.js` — wahi asli actuals jo forecasting/DSM padhte hain (CERC + price file + IEX API). Market Analytics ke saare endpoint, price alerts, **MIS PDF** ka market section aur **Trading Dashboard ke live rates** ab isi se. Range sirf block-wise din se, CERC din ka sirf price. "Volume MW" (seed ka arthheen jod) ki jagah **Cleared MWh**. `npm run seed` ab nakli market rates, 11 nakli "market events" (heatwave, coal shortage) aur weather/coal index nahi banata. Dev DB ki purani seed rows padi hain par ab koi unhe nahi padhta. 6 backend test. |
| 6 ✅ | **DAM/GDAM "Market MCP" — Bid vs Cleared chart** | `BidVsClearedAnalytics` random data banata hai; bid book database mein pada hai. | **Ho gaya.** Naya `/api/market-analytics/bid-vs-cleared`: har block mein kitna MW kis (weighted) price pe bid hua, kitna kis price pe clear hua, aur us block ka asli market MCP. Range block bid ("00:00-24:00") apna MW har covered block mein. Sirf SUBMITTED/CLEARED/PARTIALLY_CLEARED bids; trading client ko sirf apni. Screen par sirf wahi dates jin par bid hai, stub bids ki saaf warning, market price load na ho to wo bhi. Dual-axis (MW + Rs/MWh ek chart par) ki jagah do chart. Paanch `alert()` wala export menu hataya. 3 backend + 4 frontend test. |
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
