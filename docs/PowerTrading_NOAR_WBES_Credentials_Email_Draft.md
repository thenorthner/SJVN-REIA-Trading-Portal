# Email draft — NOAR & WBES access request to SJVN Power Trading

**Send from your SJVN address** (@sjvn.nic.in)

**To:** power.trading@sjvn.nic.in

**Subject:** Request for NOAR and WBES access (read-only, test use) — new Power Trading platform, ERP Cell

---

> **Fill before sending:**
> - `<YOUR_NAME>`, `<DESIGNATION>`, `<phone>`
> - Cc your reporting officer in ERP Cell if required.
> - Server IP is **49.50.97.173** (test server, test.sjvn.co.in). Note that the
>   whitelisting itself is done by Grid India / NLDC at their gateway — Power
>   Trading cannot do it. We are only asking them to forward or endorse the
>   request, since it has to come from the entity that holds the access.
> - The NOAR one-key-per-login warning in point 2 is from the Trader API
>   Implementation Guide, page 9 — this is the reason we are asking Power
>   Trading first instead of generating a key ourselves.
> - This single mail covers both NOAR and WBES; do **not** also write to
>   Grid India directly until Power Trading replies.

---

Dear Sir / Madam,

I am writing from the ERP Cell, Corporate HQ, Shimla, regarding the Power
Trading platform under development for the department.

**Purpose**

The platform automates the trading, scheduling and settlement workflow that is
today tracked manually — open-access application status, block-wise scheduled
energy, and the billing that follows from it. Two data sources are required for
this, and for both of them SJVN's access rests with the Power Trading
department:

1. **NOAR (National Open Access Registry)** — to fetch the status of SJVN's own
   open-access applications (applied / approved / rejected, approval number and
   approved MWh) through the Trader API, instead of checking the portal by hand.

2. **WBES (Web Based Energy Scheduling)** — to fetch approved block-wise
   (15-minute) schedule data for SJVN's bilateral / open-access transactions,
   which is the input for scheduled-energy computation and for the invoices
   generated from it.

**What we are requesting**

1. **WBES** — the login / credential the department already uses for WBES
   (username and the registered utility acronym for SJVN), and confirmation of
   whether that access is portal-only or includes API access.

2. **NOAR** — the API key and secret already generated on SJVN's NOAR trader
   login, rather than a fresh pair. The Trader API guide states that a NOAR
   login holds only **one active API key at a time**, and that generating a new
   key deactivates the existing one. If the department's login already has a key
   in use by any existing system, generating another would stop that system from
   working. We therefore request the existing key be shared with us, or that the
   department confirm no key exists before we generate one.

3. **Support for IP whitelisting** — both portals accept calls only from a
   registered source IP. That registration is done by Grid India / NLDC at their
   end, on a request from the SJVN entity holding the access; we cannot do it
   ourselves. We therefore request the department either to forward the
   whitelisting request for our server, or to confirm that we may write to Grid
   India directly quoting the department's access. Our test server's public IP
   is **49.50.97.173**. (Any change needed on SJVN's own network side will be
   handled by ERP Cell / IT — nothing is required from Power Trading for that.)

**What the testing will cover**

The access is required for testing at this stage, not for live operations:

- **Read-only calls only.** We will call the reporting/data endpoints
  (`Report/ApplicantBilateralApplicationData` on NOAR, and the schedule data
  endpoint on WBES). No application will be submitted, revised, approved or
  withdrawn, and no schedule will be created or modified from our side.
- **NOAR test environment first.** Grid India has provided a separate test host;
  we will test there before making any call to the production gateway.
- **Data verification.** The values fetched will be reconciled against the
  approval records and schedule reports the department already maintains, so
  that the platform's figures can be confirmed correct before anyone relies on
  them.
- **Limited scope.** Data will be pulled only for SJVN's own transactions, in
  short date windows, and stored on the SJVN test server (test.sjvn.co.in).
  Nothing is shared outside SJVN.

The integration for both is already built and is currently running against
sample data; it cannot be validated against real figures until these credentials
are available. Both items are presently blocked on this request.

Kindly advise how we may obtain the above, or whom in the department we should
approach. We are happy to come across for a short session if that is easier.

Thank you.

Regards,

`<YOUR_NAME>`
`<DESIGNATION>`, ERP Cell
SJVN Limited, Corporate HQ, Shimla
`<phone>`
`<kshitij.sharma@sjvn.nic.in>`
