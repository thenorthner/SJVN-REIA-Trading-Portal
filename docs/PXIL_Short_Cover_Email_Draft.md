# Short cover email — send with PXIL_API_Clarifications.docx attached

**To:** gaurav.tiwari@pxil.co.in
**Cc:** it@pxil.co.in; avadheshkumar.bari@pxil.co.in
**Subject:** Re: PXIL API Documentation — clarifications before Phase 1 integration
**Attachment:** PXIL_API_Clarifications.docx

---

Dear Gaurav,

Thank you for the API documentation and access details. We have completed a detailed review of all six Phase 1 documents (TAM-GTAM, TAM-GTAM Slot-Wise, Format-D, Member DOR, Reverse Auction L1 Summary and Trade Margin) and have built our integration layer against the documented request and response shapes.

Before we point it at your environment, we have a number of clarifications needed — enough that we've put them in the attached document rather than in the body of this email, organised into sections so you can reply against each item.

In short:

- **Section A** — the endpoint cannot be called as documented (URL, auth, environment, IP whitelisting, trailing slashes)
- **Section B** — the endpoint could be called, but the figures would be wrong (Member DOR's Total doesn't match its own components; Reverse Auction's L1 is below the lowest bid shown; a few other numeric inconsistencies in the samples)
- **Sections C & D** — field-level and operational confirmations to finalise the mapping

**Items A1–A5 and B1–B2 are the ones holding us up** — the rest can follow at your convenience.

A short call this week would help us close these quickly. Please let us know what works for you.

Warm regards,

Kshitij Sharma
ERP Cell
SJVN Limited, Corporate HQ, Shimla
