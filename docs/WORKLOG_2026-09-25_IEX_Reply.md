# Worklog — 25 Sep 2026
## IEX ka reply aa gaya — 11 mein se 9 points settle, code us hisaab se badla

**Branch:** `feat/trading-settlement-billing`
**Trigger:** Sandeep Kumar (IEX Market Operations) ne 23-09-2026 wale hamare
technical clarification mail ka point-by-point jawab bheja. Un jawabon mein se
jo cheezein code ko badalti hain, wo yahan lagayi gayi hain.

---

## Unke jawab — ek jagah

| # | Hamara sawaal | IEX ka jawab | Asar |
|---|---------------|--------------|------|
| 1 | Alpha pe 16 din se koi result nahi | **UAT mein clearing manual hai**, RTM bhi. Pehle se bolna padega, wo ek banda laga ke session clear karenge. PQ result **har member ko milta hai**, bid kiya ho ya na kiya ho. Alpha pe koi settlement obligation nahi | Hamari parsing galat nahi thi — environment hi clear nahi ho raha tha. Ab window maangni hai |
| 2 | REC pe 403 usi whitelisted IP se | **`49.50.97.173` REC host pe whitelisted hi nahi hai** (UAT). Token sab Front Office bidding API ke liye valid hai. Prod REC host: `recapi.iexindia.com` | Token/header ka masla nahi tha, whitelist per-host hai. REC ab bhi blocked — unse add karwana hai |
| 3 | Header `Authentication` ya `Authorization`? | **`Authorization`** hi key hai, teeno header har call mein | Jo hum 22-Sep se bhej rahe the wahi sahi. Ab pinned |
| 4 | Token ka `exp` 1 ghanta dikhata hai | Naya token nahi denge — typo tha. Prod mein system-generated token aayega jisme sahi validity hogi. Gateway galat header value pe **hamesha wahi `UnAuthorized User`** deta hai | `exp` UAT mein bharosa ke layak nahi, prod mein hoga. Expired token ko 401 se pehchanna possible nahi |
| 5 | Delivery date ke do shape kyun | DAM/GDAM/HPDAM sirf **T+1** (day-ahead hain), RTM mein **T, T+1, T-1** | Dono shape padhne wala parser sahi hai; DAM se ek se zyada date ki ummeed nahi |
| 6 | Schedule report mein `ALL` bid area | `ALL` nahi chalega. **Portfolio id ke pehle do character hi bid area hain** (`N2DL0SJVN0001` → `N2`). Hamare paas 2 portfolio hain isliye 2 area | **Bada change** — 13 area poochhne ki zaroorat nahi, hamare 2 kaafi hain |
| 7 | User login pe kaunse header | `UserId` + `ParticipantId` + `Authorization` — har call mein teeno | Jaisa chal raha hai, waisa hi |
| 8 | Scaling ka asymmetry | Poora worked example diya: submit 5.3 MW → 53 (×10), price 4500 → 4500 (×1); result 530 → 5.3 MW (÷100), 450000 → Rs 4500/MWh (÷100) | Hamara implementation exactly yahi hai. Confirm |
| 9 | Market/Status enum, Session, RTM publishinfo 404 | Status: **S start, E end, N not available**. Din 96 block ka, **do block = ek session, 48 session/din**. RTM ka path **`getpublishinfo`** hai. Publish detail ke liye RTM doc 12.8 | 404 hamari galti thi — RTM doc 11.5 mein `getpublishinfo` likha hai, hum DAM ka path chaar segment pe chala rahe the |
| 10 | Rate limit, pagination, prod cutover | **4 request/second**. Pagination doc mein hai. Prod ke liye **alag mail** bhejna padega (IP + user id), aur live mein supervised call ka provision nahi — apne bid khud Bid Book/BidDetails API se verify karne honge | Throttle lagana zaroori tha, warna prod pe pata bhi nahi chalta |
| 11 | C&S back office (post-trade reports) | **Alag token chahiye**, whitelisting ki zaroorat nahi — kisi bhi system se, sirf valid credentials se | Token aaya nahi hai, isliye C&S client abhi nahi banaya |

---

## Code mein kya badla

### `services/iexService.js`

- **Bid area ab hamare portfolio se nikalta hai.** `getPortfolioIds()` →
  `master/userportfoliomapping` se hamare portfolio, `getOurBidAreaIds()` →
  unke pehle do character. `ALL` configure ho to schedule report ab **2 call**
  karta hai (E1, N2), 13 nahi. Mapping na mile to purana rasta (poora bid area
  master) fallback hai, aur response mein `bid_area_source` bataata hai kaun sa
  rasta liya — chupke se adha report dena sabse bura outcome hai.
- **4 req/sec ka gate.** `awaitRequestSlot()` — poore process ke liye ek queue,
  kyunki limit exchange ki hai, ek report ki nahi. REC client bhi isi gate se
  kharch karta hai (same member). `iex_max_requests_per_sec` se badla ja sakta
  hai, `0` = band (tests isi ko use karte hain). Ek bug yahin pakda gaya: unset
  hone pe `Number('')` = 0 aata tha, yaani default "no limit" ban jaata — test
  ne pakda, fix hua.
- **`fetchPublishInfo(product)`** — exchange ka apna "result aa gaya" signal.
  RTM pe `getpublishinfo`, baaki pe `publishinfo`. Row decode hoti hai:
  date, session, `F`/`P` (final/provisional), `P`/`D` (published/withdrawn),
  run count. Polling ki jagah yahi trigger hai — IEX ka hi kehna.
- **200 ke andar chhupa refusal.** `asRefusal()` — bare JSON string
  (`"Invalid Bid Area Id"`) ko **har** caller pehle check karta hai. Pehle sirf
  schedule report dekhta tha; `pqresults`, `deliverydates`, asset master, bid
  area master aur portfolio mapping use object maan ke "us din data nahi hai"
  padh lete the. Settlement ke liye ye hi sabse chup rehne wali galti thi.
- Prod REC host `recapi.iexindia.com` table mein. Doc comments mein UAT manual
  clearing, token ki asli kahani, Market/Status enum aur session ka hisaab.

### Baaki

- `routes/iex.js` — `GET /api/iex/publish-info?product=` (read-only).
- `frontend` — naya tab **"Published yet?"**, schedule report ke neeche ab
  likha aata hai kaunse bid area poochhe gaye aur kyun. "Not implemented" list
  se REC prod host wali purani line hat gayi; C&S (apna token chahiye) aa gayi.
- `iexRecService.js` — token ka sawaal band (FO token hi chalta hai), 403 ki
  wajah likhi (per-host whitelist), gate share.
- Tests: `iexService.test.js` mein 13 naye (bid area source, publish info
  path/decode, refusal-as-200, rate gate) aur REC mein 1. Poora backend suite
  114 file / 1718 test pass.

---

## Abhi bhi open

1. **Alpha pe clearing window** — IEX ne kaha "agle hafte ka schedule bata do".
   Reply draft mein 29–30 Sep ka proposal hai.
2. **REC whitelist (UAT)** — unhone bataya ki IP nahi hai, add karne ka
   commitment nahi diya. Maangna hai.
3. **C&S token + report API doc confirm** — `docs/IEX_CnS_API_2.0_For_Members.pdf`
   hamare paas hai; ye current hai ya nahi, aur token kab milega.
4. **Schedule report ka test** — PQ result to bina bid ke bhi milega, par
   *hamara* cleared schedule tabhi aayega jab hamara koi bid clear ho. Submission
   hamare platform mein jaan-boojh ke band hai, to ya supervised window mein
   kholna padega ya bid Alpha web terminal se lagana padega. Mail mein poochha hai.
5. **Prod cutover** — alag mail (IP + user id), uske baad prod token.
6. **Doc versions** — mail thread mein `29June2026` wale PDF lage hain,
   `docs/Technical Document for FO API (1) (1)/` mein `10Dec2024`/`17Apr2024`
   pade hain (REC wala hi June-2026 ka hai). Naye attachment save karke diff
   karna baaki hai.
