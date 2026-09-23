# Questions for the manager — 23 Sep 2026

Everything waiting on a decision, small or large. Each one says what we would
do if nobody decides ("if no answer"), so a meeting can be a series of yes/no
answers rather than a discussion from scratch.

Grouped by who is really being asked, because several of these are for
Commercial or IT rather than for the manager personally.

---

## A. Rules we have implemented one way and need confirmed

These change money on a bill. Today's behaviour is in brackets.

1. **Rebate on PSA bills (SJVN → DISCOM).** The platform gives the
   early-payment rebate only on PPA bills (SJVN → generator), not on PSA bills
   to buyers. The masters, however, quote PSA Article 6.4 for the 1.5% / 1%
   rebate. Both cannot be right, and the PSA text is not with us.
   *Ask Commercial for the PSA clause.*
   **If no answer:** leave as it is (no rebate to buyers).

2. **LPS on calendar days or working days?** Today the platform counts working
   days for the paying party, so a beneficiary is not surcharged for days its
   office was shut. The MoP LPS Rules 2022 read as every day of delay.
   **If no answer:** leave as working days (it charges less, so nobody
   complains — but it is the weaker reading).

3. **NRLDC fee inside a hydro bill.** The beneficiary's share of the NRLDC fee
   is billed with its own charges, as one figure to pay. Rebate is not allowed
   on it. Confirm both.
   **If no answer:** leave as it is.

4. **Rebate on the PTC trading bill.** The hydro ledger now allows the CERC
   rebate on every beneficiary payment, and the PTC bill runs on the same
   ledger. If the PTC PSA has no rebate, we will switch it off for that
   contract.
   **If no answer:** rebate stays on; the desk can untick it per payment.

5. **Interest on a refund after a dispute.** The platform suggests interest at
   the LPS rate from the bill date. Arguably it should run from the date the
   over-payment was actually received. It is only a suggested figure today —
   it does not go on a bill by itself.
   **If no answer:** leave as a suggestion, no change.

6. **Who may approve a debit / credit note.** Today: any second person from
   REIA or Finance (never the one who raised it). Finance-only is a one-line
   change.
   **If no answer:** leave open to both.

7. **Tax on a debit / credit note.** The field is there and prints on the note.
   Electricity itself is GST-exempt, so most notes will carry nil; trading
   margin and open-access charges may not. Confirm with Finance which heads
   attract tax so the desk is not guessing.
   **If no answer:** the desk types the tax where it applies.

---

## B. Things that need someone's permission

8. **HTTPS on test.sjvn.co.in.** The platform is on `http://` today, so logins
   travel unencrypted. The fix needs one module installed on the IIS server,
   which restarts IIS briefly — and that touches commercial, edms, clip,
   gatepass and connect for a few seconds. We need Nikhil sir's permission and
   an off-hours window. Everything else is ready (the certificate and the site
   already exist).

9. **Apache auto-start on the server.** The web server that puts the platform
   on test.sjvn.co.in is started by hand from the XAMPP panel. If the machine
   reboots and nobody presses start, the site is down even though the platform
   is running. Making it a Windows service needs the same permission, as it
   touches edms.

10. **Demo passwords.** The seeded accounts still use `password123` on a URL
    anyone inside SJVN can reach. Whose call is it to reset them, and to what?

11. **Test bids on IEX's test environment.** IEX may say market results appear
    only for a member that has bid. Placing test bids on their Alpha
    environment involves no money and no settlement, but the platform's bid
    submission is deliberately switched off. Do we turn it on for UAT only?

12. **Branch merge and release.** All work sits on the feature branch and is
    deployed from there. When should it be merged to the main branch, and does
    any release need to be formally approved?

---

## C. Data and scope decisions

13. **FY 2025-26 hydro bills.** We can bill FY 2026-27 from the REA today.
    Billing 2025-26 needs that year's beneficiary allocation sheet, which we do
    not have. Does Commercial want the earlier year billed at all? If yes,
    please share the FY 2025-26 allocation.

14. **Which hydro stations are in scope.** NJHPS and Rampur are built and
    verified. Are others (Luhri, Dhaulasidh, Naitwar Mori…) to be added, and
    when?

15. **Beta (β) certificates.** NRPC publishes them as a letter whose numbers
    cannot be read by machine. Someone has to key β in per month, per station.
    Who does that, and from which copy?

16. **Billing formula sign-off.** The hydro bill now reproduces SJVN's own bills
    to the rupee for May and June 2026. Does Commercial want to sign that off
    formally before any bill is issued from the platform?

17. **Data migration.** How much history comes into the platform — how many
    years of contracts, bills and payments, and from which system or files?

18. **Demo data in the database.** The test server's database still carries the
    demonstration contracts and entities. Do we clear them before user testing,
    or keep them for training?

19. **Price forecasting sign-off.** The forecasting screen is built. The
    committee has to accept the model and say what accuracy is expected — and
    whether trading clients see the forecast or only SJVN's desk.

20. **CEA data.** `cea.nic.in` does not answer us. Either someone at SJVN
    obtains access, or we agree on a monthly Excel upload for the CEA figures
    the dashboards want.

---

## D. Waiting on outside parties — the manager may need to push

21. **IEX:** no market results on their test environment for 16 days, and REC
    refuses our server. Technical mail with 11 points is drafted.
22. **PXIL:** our clarification mail of 17 Sep is unanswered (IP whitelisting,
    staging dates).
23. **NOAR:** the API key must be generated from SJVN's own NOAR login — nobody
    sends it to us. **Before anyone clicks "Add", check whether a key already
    exists:** creating a new one deactivates the old one, which could break the
    existing ISET application.
24. **WBES:** no credentials, so 15-minute block-wise energy data is blocked.
25. **DSM slab rates** from the regulator: the platform holds zero rates and
    cannot verify a DSM figure until they are given.

---

## E. IT items that will block go-live later (worth flagging now)

26. SAP interface: company code, vendor / customer numbers, GL mapping.
27. Digital signature and e-invoice (GSP / IRP) for issuing bills.
28. SMS DLT registration and an SMTP relay on the server, for notifications.
29. SSO / Active Directory login instead of platform passwords.
30. A second disk for backups, encryption at rest, VAPT / CERT-In clearance.
31. Bank collection API, if payments are to be read automatically.

---

## Already decided — no need to revisit

- HPX exchange: on hold.
- Seller invoice submission by API: not doing; template upload is enough.
- Formal documents (SRS / FDD / TDD), training and UAT: later.
