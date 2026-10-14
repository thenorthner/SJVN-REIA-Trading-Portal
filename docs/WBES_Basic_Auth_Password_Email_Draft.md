# Email draft — WBES: password for usr_SJVNL (to Power Trading)

> **STATUS: DRAFT — not sent.** Send as a **reply on the existing thread**
> "Clarification Regarding NOAR Trader API Key Usage for Multiple Systems", so
> Power Trading have the 28-Sep key/URL/username mails right below it.
>
> Why Power Trading and not Grid India: the WBES access (key, username) was
> issued to SJVN and is held by O/o CGM (PT&BD); they passed us the key, URL and
> username on 28-Sep but no password.
>
> Evidence (14-Oct-2026, from the whitelisted server 49.50.97.173):
> - Every call → `401 "BASIC authentication failed."`,
>   `WWW-Authenticate: Basic realm="scheduling-api"`, `failureCode` 10004 (no
>   credential sent). Key in query and in `X-API-Key` header both refused.
> - Basic `usr_SJVNL:<API key>` → 401 with `failureCode` **10003**: the gateway
>   read the credential and rejected it, so the API key is not the password.
> - The guide's code samples all carry a masked `Authorization: ••••••` header.
>
> **Do not quote the API key or the NOAR secret.** Ask for the password over
> phone or a separate mail, not in the thread.

**Send from your SJVN address** (@sjvn.nic.in)

**To:** power.trading@sjvn.nic.in
**Cc:** praveen.kalta@sjvn.nic.in, nikhil.sharma34@sjvn.nic.in

**Subject:** Re: Fwd: Re: Clarification Regarding NOAR Trader API Key Usage for Multiple Systems

---

Respected Sir / Madam,

Thank you for the WBES details. Grid India has whitelisted our server IP
(49.50.97.173, Ticket WBES-1788772472409), and the server now reaches the WBES
gateway.

However, the gateway asks for a **password** along with the API key — every
request is returned with "BASIC authentication failed". The username
`usr_SJVNL` is accepted as the login, but no password was included with the
credentials.

We kindly request:

1. The **password for the WBES API user `usr_SJVNL`** (the one used along with
   the API key). It may please be shared over phone or a separate mail.
2. If this password is not available with your office, kindly let us know so we
   may request it from Grid India with your endorsement.

Best regards,
Kshitij Sharma
