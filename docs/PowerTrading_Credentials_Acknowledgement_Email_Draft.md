# Email draft — acknowledge the NOAR/WBES credentials, and what we are doing next

> **STATUS: DRAFT — not sent.**
> Reply to the credentials mail from **O/o CGM (Power Trading & BD), New Delhi,
> 28-Sep-2026**, in that same thread.
>
> **Do not quote the key or the secret in the reply.** They are already in the
> thread; repeating them widens the exposure for nothing.
>
> The technical asks do **not** belong here — whitelisting happens at Grid
> India's gateway and the WBES details are Grid India's to confirm. Those two
> mails are `docs/NOAR_IP_Whitelisting_Email_Draft.md` and
> `docs/WBES_IP_Whitelisting_Email_Draft.md`. This mail only keeps the department
> informed and asks the two things that are genuinely theirs.

**To:** power.trading@sjvn.nic.in (the sender of the 28-Sep mail)
**Subject:** RE: NOAR and WBES API credentials — received, and next steps

---

Respected Sir / Madam,

Thank you for the NOAR and WBES credentials.

**What we have done with them**

They have been recorded in the platform's server configuration only — not in any
shared file, document or code repository. **No key has been regenerated at our
end,** and none will be: we note the NOAR key provided is the one issued on
16-May-2026 and valid to 16-May-2027, so anything already using it continues to
work undisturbed.

**What is pending, and with whom**

**NOAR is working.** We have read SJVN's applications through the Trader API
successfully, so nothing further is needed there — we will revert separately with a
few questions to Grid India and PwC about the data itself.

**WBES is not, and needs one thing from Grid India.** Its gateway accepts only
registered IP addresses — it closes the connection before our request is even sent
— which the department cannot register on its own. We are therefore writing to
Mr. Anupam Kumar, with this department in copy, to have our test server's address
(**49.50.97.173**) whitelisted, and to confirm the exact value SJVN's schedules are
filed under (against "registered utility acronym" we were given "SJVN Limited",
which reads as the entity's name rather than the code the API expects).

**Two things we would request from the department**

1. **Kindly endorse those requests** if Grid India comes back to you for
   confirmation — the access rests with your department, not with the ERP Cell.
2. **Is any existing system or vendor using the same NOAR API key?** If so we
   will keep strictly to read-only calls on it, which is all the Trader API
   offers in any case, and will never regenerate it. Also, if you know whether
   the key was obtained for NOAR's production or its test instance, that would
   save us a round of questions.

Our use of both remains read-only: NOAR to read the status of SJVN's own
open-access applications, WBES to read approved block-wise schedules. Neither
offers a submit API, so filing applications and Format-D remain portal activities
as they are today.

Thanks and regards,

Kshitij Sharma
ERP Cell
SJVN Corporate HQ, Shimla
