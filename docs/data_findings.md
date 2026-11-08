# Data findings on the Vocca export (Attio, 2026-09-25)

Volumes: 1,506 deals, 5,080 companies, 14,680 contacts, 28 people in `sales_team`.
Produced with the scripts in `scripts/` (`profile.py`, `checks_deals.py`, `checks_accounts.py`, `checks_extra.py`).

## 1A. Numbers in the export that cannot be taken at face value (dashboard)

| # | Issue | Size | Consequence for the dashboard |
|---|---|---|---|
| 1 | `close_date` is filled on open deals: it is used as an expected close date | 500 / 539 open deals | A deal is closed only if its `stage` is Closed Won / Closed Lost |
| 2 | Won deals without `signed_date` | 176 / 567 | Booking date = `signed_date`, falling back to `close_date` (changes the month for 52 deals) |
| 3 | Won deals without `signed_arr`, or at 0 | 36 + 10 | Fall back to `forecasted_arr`, and flag it |
| 4 | Missing funnel dates on won deals: no `demo_held_date` (390/567), no `quote_sent_date` (379/567) | ~70% | No date-based funnel; stages reached are derived from the stage |
| 5 | 145 deals Closed Lost "Too much time with no sales actions", closed in bulk on 20-25 Jul 2026 | 145 | A pipeline clean-up, not real losses of the month; distorts July win rate and cycle time |
| 6 | Outlier `forecasted_arr`: €4,988,890 on one deal (next largest €766k); raw open pipe €12.2M | 1 deal + a long tail | Capped and flagged; weighted pipe shown instead |
| 7 | `closing_probability` blank on 49%; lost deals at 75-90%, won deals at 25% | about half | Ignored; pipe weighted by stage |
| 8 | Source `Group Rollout` typed `New` | 165 | Inflates new logos: these are expansions of a group account |
| 9 | `Group Rollout` without `group_contract` = TRUE | 102 | `group_contract` not reliable |
| 10 | Deals owned by non-AEs: Ops 76, AM 42, SDR 16, Other 11, CS 3 | 148 | Filtered on role; shown as "outside AE table" |
| 11 | Deals owned by people who left | 102 (13 still open) | History kept; open ones need reassigning |
| 12 | `created_by` blank (13%) or `API · n8n` (182 deals) | ~380 | SDR attribution of booked demos not reliable |
| 13 | Open-pipe hygiene: 288 deals older than 90 days, 311 with an overdue next step, 227 without one, 99 with an expected close in the past; no open deal has a next step in the future | out of 539 | These become dashboard metrics |
| 14 | 37 deals in USD, only 2 owned by the US AE | 37 | Converted to EUR |
| 15 | Uneven history: 1 deal in May 2025, 6 in April 2025 | early 2025 | Probably incomplete history; excluded from trends |
| 16 | Specialty taxonomy: Ophtalmology / Ophthalmology, Chirurgy / Surgery, lowercase "rhumatology" | 29 values | Needs a mapping table |
| 17 | Deals on companies missing from the export (3) or without `type` (19) | 22 | Minor |

## 1B. Companies and contacts base (TAM)

### Identity keys
- SIRET: 761 values with 9 digits (SIREN typed in the SIRET field), 14 values with 17 characters or non-digits, 15 others of invalid length: about 790 invalid values (16%), plus 10% empty.
- 181 SIRETs shared by 378 rows. Only 27 of these are a legitimate parent-child link: the rest are duplicates.
- 178 normalised name + postcode keys over 362 rows: likely duplicates.
- Domains: 233 rows share 96 domains. Practice "domains" include doctolib.fr (15), maiia.com (14), wanadoo.fr (12), pagesjaunes.fr (10) and gmail.com (5): junk values.
- Switchboard phone shared by 138 rows, calendar URL by 155, LinkedIn by 107. Phones come in at least 5 formats.

### Hierarchy
- 3 records are their own parent.
- Inconsistent types: 12 Practices under a Practice, 5 Groups under a Practice, 19 Groups under a Group, 65 rows without `type`.
- 112 Groups without any child practice, 76 with a single child.
- `practice_count` does not match the number of children in the CRM for 233 of 329 Groups.
- 53 rows typed Practice have `practice_count` above 1: mistyped groups.
- 572 children have a different `sales_owner` from their parent.

### Untrustworthy fields
- `lifecycle` empty on 334 rows. A Hyperline ID sits on 204 non-customers (99 Prospects, 37 Leads). 188 Customers have no ARR and 210 no billing ID. 70 rows have a `customer_lifecycle` without being Customers.
- 16 Closed Won deals sit on a company that is neither Customer nor Churn. Conversely, 406 Customers have no won deal in the export (possibly signed before 2025, to be checked).
- `country` contains "France", "fr", "Libourne", "Saint-Jean" and 118 blanks. 55 non-French rows have a French `area`.
- Specialties: 37 distinct values with synonyms (Surgery / Chirurgy, Physical Therapist / Kinesitherapy, Radiology / Imaging).
- Owners: 177 accounts owned by people who left, 16 with an SDR as `sales_owner`, 21 with an `am_owner` missing from `sales_team`.

### Contacts
- 450 contacts without a company. 2,439 contacts attached to a Group or Superorga rather than to the practice.
- 284 duplicates on first name + last name + company. 134 RPPS numbers appear on 268 rows.
- An RPPS sits on 924 Administrative contacts although RPPS is for practitioners only; 2,118 Practitioners have none.
- 279 contacts have a work email whose domain belongs to another account family: attached to the wrong account.
- 652 emails on webmail domains; 22 emails shared by several contacts.
- 1,465 companies have no contact. 69% of contacts come from the enrichment pipeline and 74% of contacts have no email.

### Limits of the anonymisation
Names and towns were reshuffled during anonymisation, so person-name matches across companies (3,625) are not usable and are not reported as a finding.
