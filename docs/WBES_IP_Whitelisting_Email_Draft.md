# Email draft — WBES: whitelist 49.50.97.173

> **STATUS: DONE — Grid India confirmed 14-Oct-2026: 49.50.97.173 whitelisted on
> the firewall for `usr_SJVNL` (ticket WBES-1788772472409).**
>
> (Original draft below, kept for the record.) Deliberately short: one ask, nothing else.
>
> **Do not quote the API key.** Grid India issued it; the entity and username
> identify us. If they ask, give the first and last four characters only.
>
> **The acronym question is left out on purpose.** Asked for SJVN's registered
> utility acronym they answered "SJVN Limited", which reads as the entity's name
> rather than the token the API expects (`SJVNL` would match the username
> `usr_SJVNL`). Once the IP is registered, `tools/noar-probe` tries the
> candidates and the gateway itself settles it — so it is only worth a mail if
> that fails. `GetLatestFullSchdRevNo` needs no acronym at all, so access can be
> proved without it.

**Send from your SJVN address** (@sjvn.nic.in)

**To:** anupamkumar@grid-india.in
**Cc:** power.trading@sjvn.nic.in

**Subject:** WBES API — request to whitelist IP 49.50.97.173 — SJVN Limited

---

Dear Sir,

Further to our request for WBES API access, the API key, endpoint URL and
username are now with us. Access from our server is the only pending item.

Kindly whitelist the following at the gateway:

| | |
|---|---|
| Entity | SJVN Limited |
| Username | `usr_SJVNL` |
| IP to whitelist | **49.50.97.173** |
| Server | test.sjvn.co.in |

Our use is read-only — block-wise schedule data for SJVN's own transactions.

Kindly confirm once done, and let us know if any form is required from our side.

Thanks and regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
`<phone>`
kshitij.sharma@sjvn.nic.in
