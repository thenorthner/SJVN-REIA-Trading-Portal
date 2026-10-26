# Email draft — WBES: password for usr_SJVNL is rejected (to Power Trading)

> **STATUS: DRAFT — not sent.** Reply on the same thread where Power Trading
> sent the password (14-Oct-2026, and the corrected one on 21-Oct-2026).
>
> Evidence (server 49.50.97.173):
> - **14-Oct 11:33 UTC** — Basic `usr_SJVNL` + first password received
>   (fingerprint `31ef7ff0`, checked identical to the mail) → `401 "BASIC
>   authentication failed."`, `failureCode` **10003** on all 6 calls.
> - **21-Oct 09:49 UTC** — Basic `usr_SJVNL` + the second password received
>   (fingerprint `85417c53`) → the same `401` / `failureCode` **10003** on all
>   6 calls (revision-no key-in-query and key-in-header, schedule with
>   acronyms SJVNL / SJVN Limited / SJVN / empty).
> - 10003 is also the code a deliberately wrong password gives (API key tried
>   as password, 14-Oct 08:17 UTC). With no credential at all the code is
>   10004. So the gateway reads our credential and rejects it. IP whitelist
>   and TLS are fine (handshake completes from 49.50.97.173).
> - The second password looks like the WBES **web portal** password; the API
>   gateway (`scheduling-api` realm) may use a separate login, or the API
>   account may be inactive / locked.
>
> **Do not retry** — about 19 failed Basic logins so far; further attempts
> risk locking the account. **Do not quote the password or key in the mail.**
> Grid India ticket for the whitelisting: `WBES-1788772472409`.

**Send from your SJVN address** (@sjvn.nic.in)

**To:** power.trading@sjvn.nic.in
**Cc:** praveen.kalta@sjvn.nic.in, nikhil.sharma34@sjvn.nic.in

**Subject:** Re: WBES API — password for usr_SJVNL

---

Respected Sir / Madam,

Thank you for sharing the updated password.

We tried it today (21-Oct-2026) from our whitelisted server (49.50.97.173) with
the username `usr_SJVNL`. The WBES API gateway
(`gateway.grid-india.in/POSOCO`) still declines the login with "BASIC
authentication failed". The first password (14-Oct) was declined the same way.
The response shows the credentials are being received but not accepted. The IP
whitelisting and connection are working.

Could you kindly confirm:

1. Whether this password is meant for the **API gateway** (Basic
   authentication) or only for the WBES web portal. If the API has a separate
   password, kindly share that.
2. Whether the API username is exactly `usr_SJVNL`.
3. Whether the API account is **active** and not locked. If it is locked,
   kindly get it unlocked from Grid India (ticket WBES-1788772472409 refers to
   the IP whitelisting for this user).
4. If a reset is needed, it may please be got done from Grid India (the
   gateway owner).

We have stopped further attempts so that the account does not get locked, and
will retest once we hear from you.

Best regards,
Kshitij Sharma
