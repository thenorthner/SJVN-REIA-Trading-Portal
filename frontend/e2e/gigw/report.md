# GIGW 3.0 / WCAG 2.1 AA audit

Run 2026-10-20T11:00:23.214Z against http://localhost:4000.

**Score: 98.6%** — 284 of 288 checks pass.

## Failing checks
| Area | Page | Check | Detail |
|---|---|---|---|
| Policies | /contact-us | Web Information Manager named (name, designation, e-mail) | {} |
| Policies | /grievance-redressal | Grievance Officer named | {} |
| Policies | /grievance-redressal | Data Protection Officer named | {} |
| WCAG 2.1 AA | /cookie-policy | axe-core: no serious or critical violations | color-contrast(serious,1) |

## axe-core findings by rule
| Rule | Impact | What | Pages (nodes) | First node |
|---|---|---|---|---|
| color-contrast | serious | Elements must meet minimum color contrast ratio thresholds | /cookie-policy (1) | `article > div > p` |
