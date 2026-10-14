# Email draft — WBES: password for usr_SJVNL is rejected (to Power Trading)

> **STATUS: DRAFT — not sent.** Reply on the same thread where Power Trading
> sent the password (14-Oct-2026).
>
> Evidence (14-Oct-2026 11:33 UTC, server 49.50.97.173):
> - Basic `usr_SJVNL` + the password received (fingerprint `31ef7ff0`, checked
>   identical to the mail) → `401 "BASIC authentication failed."`,
>   `failureCode` **10003** on all 6 calls — the same code as a deliberately wrong
>   password (API key tried as password, 08:17 UTC). Without any credential the
>   code is 10004. So the gateway reads our credential and rejects it.
> - The password reads like it was set in April 2026 (`…042026`); it may have
>   been changed or expired since, or the gateway login may differ from the
>   WBES username.
>
> **Do not retry blind** — 13 failed Basic logins so far; guessing usernames
> risks locking the account. **Do not quote the password or key in the mail.**

**Send from your SJVN address** (@sjvn.nic.in)

**To:** power.trading@sjvn.nic.in
**Cc:** praveen.kalta@sjvn.nic.in, nikhil.sharma34@sjvn.nic.in

**Subject:** Re: WBES API — password for usr_SJVNL

---

Respected Sir / Madam,

Thank you for sharing the password.

We tried it today from our whitelisted server (49.50.97.173) with the username
`usr_SJVNL` and the API key. The WBES gateway still declines the login with
"BASIC authentication failed". The response indicates the credentials are being
received but not accepted, i.e. the password does not match what the gateway
holds for this user.

Could you kindly check:

1. Whether this is the **current** password — it may have been changed or
   expired since it was set.
2. Whether the API login uses the username `usr_SJVNL` or a different one.

If the password needs to be reset, it may please be got done from Grid India
(the gateway owner). We have paused further attempts so that the account does
not get locked.

Best regards,
Kshitij Sharma
