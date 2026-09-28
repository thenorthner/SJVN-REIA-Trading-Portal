# SMS Alerts — final list for DLT registration

**Date:** 28 September 2026
**Total: 50 content templates**, all under category **Service – Implicit**.

Each line below is one template to be registered on the DLT portal. `{#var#}` is
the DLT variable placeholder (30 characters each). Fixed text must match exactly
at send time. No URL, phone number or email address appears in any template —
TRAI requires those to be separately whitelisted, and a message carrying an
unwhitelisted link is dropped.

Registering a template does not mean it starts sending. Which alerts actually go
out over SMS is controlled separately in the platform's master data, per event.
The list is deliberately broader than what is switched on today, so that turning
an alert on later does not need a fresh approval cycle.

## Billing and Invoicing

1. SJVN: Invoice {#var#} is available for payment (due {#var#}). View on the portal.
2. SJVN: Payment of Rs {#var#} recorded against {#var#}. Status now {#var#}.
3. SJVN: Seller invoice {#var#} has been submitted for review.
4. SJVN: Invoice {#var#} is approved and ready for despatch.
5. SJVN: Invoice {#var#} was returned in approval. Reason: {#var#}
6. SJVN: Invoice {#var#} has been cancelled. Reason: {#var#}
7. SJVN: Arrear bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}.
8. SJVN: Supplementary bill raised for contract {#var#} for period {#var#}, amount Rs {#var#}.
9. SJVN: Payment of Rs {#var#} released against invoice {#var#}.
10. SJVN: Invoice {#var#} of Rs {#var#} falls due on {#var#}. Kindly arrange payment.
11. SJVN: Invoice {#var#} of Rs {#var#} was due on {#var#} and is outstanding. Late payment surcharge applies.
12. SJVN: {#var#} note {#var#} of Rs {#var#} has been issued against invoice {#var#}.

## Hydro Station Billing

13. SJVN: Hydro bill {#var#} for {#var#} is pending your approval.
14. SJVN: Hydro bill {#var#} for {#var#} has been approved and can be issued.
15. SJVN: Hydro bill {#var#} was rejected in approval. Reason: {#var#}
16. SJVN: Hydro bill {#var#} for {#var#} is issued. Your share is Rs {#var#}, due {#var#}.
17. SJVN: Hydro bill {#var#} was despatched on {#var#}. Courier reference {#var#}.
18. SJVN: Hydro bill {#var#} for {#var#} has been revised. Differential amount Rs {#var#}, due {#var#}.
19. SJVN: Payment of Rs {#var#} received against hydro bill {#var#}. Outstanding is now Rs {#var#}.
20. SJVN: Hydro bill {#var#} of Rs {#var#} was due on {#var#} and remains unpaid.
21. SJVN: Late payment surcharge of Rs {#var#} charged on hydro bill {#var#} as on {#var#}.
22. SJVN: Hydro bill {#var#} for {#var#} has been cancelled. Reason: {#var#}

## Payment Security

23. SJVN: Payment security against contract {#var#} is short by Rs {#var#}. Replenish by {#var#}.
24. SJVN: Payment security cover on contract {#var#} has fallen to {#var#} percent of the required amount.
25. SJVN: Payment security instrument {#var#} against contract {#var#} expires on {#var#}.
26. SJVN: Payment security instrument {#var#} has been invoked for Rs {#var#} against contract {#var#}.
27. SJVN: Payment security instrument {#var#} against contract {#var#} has been released.
28. SJVN: Scheduling on contract {#var#} is on hold - payment security is inadequate.

## Disputes

29. SJVN: Your dispute {#var#} has been acknowledged and is under review.
30. SJVN: Further information is required on dispute {#var#}. Please respond by {#var#}.
31. SJVN: Dispute {#var#} has been resolved. Outcome: {#var#}
32. SJVN: Dispute {#var#} is approaching its resolution deadline of {#var#}.
33. SJVN: SLA breached on dispute {#var#} - escalated.
34. SJVN: SLA breached on dispute {#var#} assigned to you.

## Reconciliation

35. SJVN: Reconciliation statement {#var#} for {#var#} is ready for your sign-off by {#var#}.
36. SJVN: Reconciliation {#var#} has been disputed by {#var#}.

## Contract and billing calendar

37. SJVN: Bill presentation for {#var#} is due on {#var#}.
38. SJVN: Settlement on contract {#var#} for {#var#} is due on {#var#}.
39. SJVN: Contract {#var#} expires on {#var#}.
40. SJVN: {#var#} for {#var#} expires on {#var#}. Please submit a renewed copy.

## Scheduling and deviation

41. SJVN: Schedule deviation of {#var#} percent recorded on contract {#var#} for {#var#}.
42. SJVN: DSM bill {#var#} for {#var#} of Rs {#var#} has been despatched.

## Regulatory

43. SJVN: Form IV filing for {#var#} is due on {#var#}.

## Account security

44. SJVN: A change of bank account has been requested on your registration. If this was not you, contact SJVN immediately.
45. SJVN: {#var#} is your verification code for the SJVN portal. Valid for {#var#} minutes. Do not share it.

## Power Trading (NOAR)

46. SJVN: NOAR open-access approved for {#var#} ({#var#}). Schedules can now be punched.
47. SJVN: NOAR application rejected for {#var#} ({#var#}) - {#var#}
48. SJVN: {#var#} NOAR application(s) rejected - {#var#}
49. SJVN: NOAR approval overdue for {#var#} ({#var#}) - {#var#}d pending against a {#var#}d {#var#} target
50. SJVN: NOAR approval at risk for {#var#} ({#var#}) - {#var#}d of {#var#}d target elapsed

---

## Alongside the templates, three more registrations are needed

1. **Principal Entity (PE)** — SJVN registers itself on any one access provider's
   DLT portal (Jio / Airtel / Vi / BSNL) with PAN, GST, CIN and an authorised
   signatory. It propagates to the other operators.
2. **Header (Sender ID)** — 6 alphabetic characters, proposed `SJVNLT`, with one
   fallback in case it is already allotted.
3. **Telemarketer chain binding** — the SMS gateway has to be linked to SJVN as
   its registered telemarketer.

## A note on template 45

The platform has no OTP or two-factor login today. Template 45 is included
because if portal 2FA is added later, registering it then means another approval
cycle. Note also that because SJVN is not registered with RBI / SEBI / IRDAI /
PFRDA, an OTP from SJVN is filed under **Service – Implicit**, not under the
Transactional category.

## Points to confirm

1. Is SJVN already registered as a Principal Entity on any DLT portal for another
   system (HR, payroll, an existing SAP alert)? If so, the PE and possibly the
   header already exist, and only the templates need filing.
2. Which SMS gateway is confirmed? The platform is presently built against
   TextGuru. The telemarketer chain binds to one specific vendor, so if there is
   an empanelled vendor under a GeM or corporate contract, that has to be settled
   first.
3. For the hydro rows (16–22), the fifteen beneficiary DISCOMs have no contact
   mobile number on record in the platform. Filing the templates does not depend
   on this; sending does.
4. Should internal alerts go to individual officers' mobile numbers, or to a
   single ops-desk number? The platform supports both.
