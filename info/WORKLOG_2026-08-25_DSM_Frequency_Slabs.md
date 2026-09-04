# Worklog — 25 Aug 2026
## Deviation (DSM) charges — frequency-linked slabs

**Branch:** `feat/trading-settlement-billing`
**Pichhla gap:** [WORKLOG_2026-08-16](WORKLOG_2026-08-16_Trading_Settlement_Billing.md) §8 — *"DSM frequency-linked slabs — abhi simplified flat; CERC notification ke bina guess nahi"*

---

## Problem

`bilateral.js` mein deviation charge ek placeholder se aa raha tha:

```js
amount: Math.abs(deviationMw) * 60   // FLAT_PLACEHOLDER
```

Ye number kisi regulation se nahi aata tha — na frequency dekhta tha, na over/under
side, na hi per-MWh basis. Phir bhi settlement isko utha ke energy bill pe
**"Deviation (DSM) charges"** line item bana raha tha. Yaani bill pe ek aisa
figure ja raha tha jiska koi source nahi.

---

## Kya banaya

### 1. Slab master — `dsm_charge_slabs`

Effective-dated table, `rate_master` wali hi shakal:

| Column | Kaam |
|--------|------|
| `deviation_side` | OVER / UNDER / BOTH |
| `freq_from_hz` — `freq_to_hz` | half-open band `[from, to)`; NULL end = open |
| `charge_basis` | `FLAT` (paise/kWh) ya `PCT_OF_REFERENCE` (% of DAM ACP) |
| `charge_value`, `cap_paise_per_kwh` | rate + optional cap |
| `settlement_sign` | +1 charge on party, −1 credit to party |
| `effective_from` / `effective_to` | revision history, non-overlapping |
| `is_verified` | **0 jab tak notified rate enter na ho** |

Seed sirf **band structure** deta hai — 50 Hz ke dono taraf normal band
(49.95–50.05), dono sides pe — **rates khaali, `is_verified = 0`**.
CERC notification repo mein hai nahi, to rate guess karke nahi bhare.

### 2. Calculator — `services/dsmCharges.js`

`computeDsmCharge({ deviationMwh, frequencyHz, onDate })` → amount + **basis**:

| Basis | Matlab |
|-------|--------|
| `CERC_SLAB` | slab se priced (slab_id + rate return hota hai) |
| `NO_DEVIATION` | block schedule pe tha |
| `NO_FREQUENCY` | block pe frequency record hi nahi |
| `NO_SLAB` | us date/band ke liye slab nahi |
| `SLAB_UNVERIFIED` | slab hai, notified rate nahi |
| `NO_REFERENCE_PRICE` | % slab hai, DAM ACP us din ka nahi mila |

Poora point: **unpriced ≠ free.** Har non-priced case zero ke saath ek reason
aur warning deta hai, plausible-dikhne-wala rupee figure nahi.

### 3. Block actuals

`POST /api/bilateral/schedules/:id/actuals` ab `grid_frequency_hz` leta hai aur
block pe `grid_frequency_hz`, `dsm_slab_id`, `dsm_rate_paise_per_kwh`, `dsm_basis`
store karta hai — yaani har penalty wapas apne slab tak trace hoti hai.
Frequency baad mein correction mein chhoot jaye to pehle wali retain hoti hai.

Desk pe bhi wire hai: Bilateral detail ka **Record Actuals (DSM)** ab `prompt()`
nahi, ek form hai — Actual MW + Grid frequency — aur submit pe wahi batata hai ki
block price hua (`₹X at Y p/kWh · slab`) ya kyun nahi. DSM Tracker table mein
Frequency column add hui, aur unpriced block pe `-` ki jagah
**"unpriced — no frequency"** jaisa badge aata hai.

### 4. Settlement / bill

`summariseSchedules` ab `unpriced_deviation_blocks` count karta hai, aur energy
bill pe warning aati hai:

> *N block(s) deviated but carry no DSM slab price — the deviation charge on this bill excludes them*

### 5. API + screen

- `/api/masters/dsm/slabs` — list / create / patch (rate enter + verify)
- `/api/masters/dsm/slabs/effective` — kaunsa slab kis frequency ko price karega
- `/api/masters/dsm/preview` — bina record kiye deviation price karo
- `/api/masters/dsm/readiness` — kitne band abhi bhi rate ka intezaar kar rahe hain
- Screen: **Power Trading → Open Access → Deviation (DSM) Slabs** (`DsmSlabMaster.jsx`)
  — readiness strip, "what would a deviation cost?" preview, slab register with
  Verified / **Cannot Price** status

Verify karne ka guard dono taraf hai: bina `charge_value` ke slab verified nahi
ho sakta (400), aur unverified slab bill price nahi kar sakta.

---

## Tests

`tests/dsmCharges.test.js` (19) + `tests/dsmChargesApi.test.js` (12).
Full suite: **780 passed / 53 files** (`cd backend && npm test`).

---

## Ab bhi pending

| Gap | Why |
|-----|-----|
| Actual notified slab rates | CERC/SERC notification chahiye — desk screen pe enter karega, code se nahi |
| Sub-bands (49.90 / 49.85 etc.) | Notification aane pe UI se add ho jayenge, schema already supports |
| Frequency ka auto-feed (RLDC/SLDC DSM account) | Live Grid API pe blocked; abhi desk form se manual entry |
| 192.168.58.63 pe deploy | Office LAN pe hi reachable — us network se `python3 deploy_to_192.py` |
