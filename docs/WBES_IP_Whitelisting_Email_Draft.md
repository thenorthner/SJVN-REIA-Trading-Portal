# Email draft — WBES: whitelist 49.50.97.173 (and confirm the acronym literal)

> **STATUS: DRAFT — not sent.**
>
> **Do NOT quote the WBES API key in this mail.** Grid India issued it; they can
> identify it from the entity and, if they ask, its first and last four
> characters. Sending a key back over mail adds risk and nothing else.
>
> **Why this goes to Grid India:** the WBES guide, §2 *API Security*, states —
> "IP Whitelisting: Whitelisting of IP will be done at gateway level." Only they
> can do that. They are also the ones who issued the key, so they are the right
> people to confirm the username it was issued against and the registered
> acronym — Power Trading would have to ask them anyway.
>
> Mr. Anupam Kumar is the contact already used for WBES access
> (`docs/WBES_API_Email_Draft.md`). Power Trading is copied because the access
> rests with them.
>
> **Updated 28-Sep-2026:** they have since supplied the endpoint URL
> (`https://gateway.grid-india.in/POSOCO/...?apikey=`) and the username
> (`usr_SJVNL`); both are configured. Only the whitelisting is still blocking.
> Against "registered utility acronym" they answered *"SJVN Limited"*, which is
> the entity's name rather than an acronym token — so that one line remains, but
> as a confirmation, not a request.

**Send from your SJVN address** (@sjvn.nic.in)

**To:** anupamkumar@grid-india.in
**Cc:** power.trading@sjvn.nic.in

**Subject:** WBES API — IP whitelisting request (49.50.97.173) — SJVN Limited

---

Dear Sir,

I am writing from the ERP Cell, SJVN Limited, Corporate HQ, Shimla, further to
our earlier request for WBES API access.

Thank you for the endpoint URL and the username `usr_SJVNL`. Together with the
API key already provided to us through SJVN's Power Trading department, both are
now configured at our end, and no new credential is required.

One thing is blocking, and one needs a word of confirmation.

**1. IP whitelisting — the blocking item**

We have confirmed from our end that this is the only thing blocking us, and that
nothing else can even be attempted until it is done. From our (unregistered)
network, `gateway.grid-india.in` resolves and TCP port 443 opens, but the TLS
handshake is then closed without a reply — our client sends its handshake and
reads back zero bytes, with no certificate served. In other words the API key is
never transmitted at all, so we cannot verify the key, the username or the
acronym beforehand.

Kindly **whitelist 49.50.97.173** at the gateway for SJVN's WBES API access:

| Item | Value |
|---|---|
| Entity | SJVN Limited |
| Public IP to whitelist | **49.50.97.173** |
| Server | test.sjvn.co.in (SJVN's test server for the platform under development) |
| API called | `POST .../reports/1.0/WebAccessAPI/GetUtilityExternalSharedData` — read-only |
| Expected volume | one call per delivery day, occasionally a few for revisions |

**2. The exact value for `UtilAcronymList`**

Against the registered utility acronym you have written **"SJVN Limited"**. We
read that as the entity's name — in the guide every acronym is a token, such as
`["BIHAR_STATE"]` in your own example — so kindly confirm the literal value the
API expects in `UtilAcronymList`:

- is it **`SJVNL`** (which would match the username `usr_SJVNL` issued to us), or
- the string **`SJVN Limited`** exactly as written, or
- may the list be sent **empty** (`"UtilAcronymList": []`, as the guide's second
  example shows), in which case the API returns whatever this credential is scoped
  to and we would prefer that?

We ask because a value the gateway does not recognise returns an empty schedule
rather than an error, which on our side is indistinguishable from a day on which
nothing was scheduled — and that difference ends up in an invoice. If SJVN's
schedules are held station-wise, kindly also share the station acronyms.

We will begin with `GetLatestFullSchdRevNo`, which takes only the date and the
username, so that access can be verified before any of the above matters.

**Purpose:** to read approved block-wise (15-minute) schedule data for SJVN's
bilateral and open-access transactions into the department's commercial platform,
which today computes scheduled energy and raises invoices from figures keyed in by
hand. Read-only: we understand the platform publishes Get Schedule Data, Get
Latest Revision No and Get All Revisions, and no submit API, so Format-D and the
NOAR application itself remain portal activities.

Kindly let us know once the address is registered, and if any form or approval is
required from our side.

Thanks and regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
`<phone>`
kshitij.sharma@sjvn.nic.in
