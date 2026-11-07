# Vocca CRM export: RevOps business case dataset

Exported 2026-09-25 from our CRM (Attio). Four CSV files, UTF-8, comma-separated, one header row.

| File | Rows | What it is |
| --- | --- | --- |
| `companies.csv` | 5,080 | Accounts: practices, groups of practices and the entities above them |
| `contacts.csv` | 14,680 | People: practitioners, practice managers, secretaries, owners |
| `deals.csv` | 1,506 | Sales opportunities, January 2025 to September 2026 |
| `sales_team.csv` | 28 | Everyone who owns or opened a deal in the period |

**The data is anonymised.** The structure is real: which deal sits on which account, which practice
belongs to which group, how the pipeline moved month by month, how full each column is. Every name, legal
name, SIRET, domain, email, phone, address, LinkedIn URL and ID has been replaced, towns have been reshuffled
within each region, and amounts and dates have been lightly perturbed. Don't try to find the real practices
behind the rows: they cannot be recovered from this file. Phone numbers are drawn from ranges reserved for
fiction, so nothing in the file will ring.

The files come straight out of the CRM, with no cleaning. The definitions below say how each field is
*meant* to be used, and the data does not always follow them. Working out where it doesn't, and what you
would do about it, is part of the exercise.

The files join on `record_id`:

```
companies.record_id ◄── companies.parent_record_id     (practice → group → superorga)
companies.record_id ◄── contacts.company_record_id
companies.record_id ◄── deals.company_record_id
contacts.record_id  ◄── deals.associated_people          (comma-separated, up to 4)
sales_team.name     ◄── deals.owner, deals.created_by, companies.sales_owner / sdr_owner / am_owner
```

## How we sell, in one paragraph

An SDR (or an automation) books a demo on a practice or a group. The deal is created at **Demo
Scheduled**, owned by an AE. After the demo it moves to **Demo Held**, then **Qualified** once the AE has
confirmed need, budget and decision maker, then **Quoted** when the quote goes out from our billing tool.
A signed quote closes the deal as **Closed Won**. Anything that dies along the way is **Closed Lost** with a
reason. Groups often sign a framework agreement, then roll out practice by practice: those follow-on deals
have the source `Group Rollout`. Prices are per practitioner (multi-specialty practices) or per machine
(radiology), billed yearly. ARR is excluding VAT.

## `deals.csv`

| Column | Meaning |
| --- | --- |
| `record_id` | Deal ID |
| `deal_name` | Free text, no enforced convention |
| `stage` | Demo Scheduled → Demo Held → Qualified → Quoted → Closed Won / Closed Lost |
| `owner` | AE accountable for the deal |
| `created_by` | Who created the record: usually the SDR or AE who booked the demo, sometimes an automation |
| `type` | `New` (new logo), `Upsell` (more on an existing product), `Cross-sell` (new practice or product for an existing customer), `Retention` |
| `source` | First touch that made the opportunity exist, set at creation |
| `specialty` | Medical specialty of the account |
| `company_record_id` | Account the deal is on (a practice or a group) |
| `associated_people` | Contacts involved |
| `created_at` | Creation timestamp (UTC) |
| `demo_scheduled_date` | Date the demo was booked for |
| `demo_held_date` | Date the demo took place |
| `quote_sent_date` | Date the quote was sent |
| `signed_date` | Date the quote was signed |
| `close_date` | Date the deal was closed, won or lost |
| `go_live_date` | Date the customer went live, after onboarding |
| `estimated_closing_date` | AE's forecast of the close date |
| `next_step_due_date` | Due date of the AE's next action |
| `currency` | `EUR` or `USD`; every amount on the row is in this currency |
| `forecasted_arr` | Projected ARR of the deal |
| `signed_arr` | ARR on the signed quote |
| `one_off_fees` | Setup and implementation fees, not part of ARR |
| `closing_probability` | AE's estimate |
| `loss_reason` / `closed_lost_step` | Why and at which stage a lost deal died |
| `master_calendar` | Booking software the practice uses (it drives the integration effort) |
| `group_contract` | Deal signed under a group framework agreement |

## `companies.csv`

| Column | Meaning |
| --- | --- |
| `record_id`, `created_at`, `created_by` | ID, creation timestamp, who or what created it |
| `name` | Trading name |
| `legal_name`, `siret`, `legal_structure_type` | Legal entity. SIRET is the French 14-digit establishment number: the first 9 digits (SIREN) identify the legal entity, so several sites can share a SIREN |
| `type` | `Practice` (one site), `Group` (several practices), `Superorga` (a network of groups) |
| `parent_record_id` | The group or superorga this record belongs to |
| `domains`, `standard_phone`, `linkedin_url` | Website domain(s), switchboard number, LinkedIn page |
| `address_line`, `postcode`, `city`, `country`, `area` | Location. `area` is our internal sales territory |
| `specialty` | Medical specialties, multi-valued |
| `structure_type` | Liberal practice, health centre, MSP (multi-disciplinary practice), private clinic, hospital… |
| `master_calendar`, `calendar_url` | Booking software and public booking page |
| `practitioners`, `practice_count`, `number_of_machines`, `employee_range`, `decision_maker_count` | Size signals |
| `lifecycle` | `Lead` (in the TAM, not worked yet), `Prospect` (being worked), `Customer`, `Churn` |
| `customer_lifecycle` | For customers: Onboarding, Active, Monitoring, Inactive |
| `business_relationship_type` | `Sales` for prospects and customers; `Invest`, `Partner`, `Media` for everything else |
| `sales_owner`, `sdr_owner`, `am_owner` | Account owners |
| `sources`, `enrichment_batch` | How the record entered the CRM, and which enrichment run touched it |
| `icp_excluded` | Flagged as out of our ideal customer profile |
| `arr_signed_eur`, `hyperline_customer_id` | Signed ARR and billing ID, customers only |
| `allo_calls_count`, `last_interaction_at` | Calls logged from our telephony tool, last email or meeting |

## `contacts.csv`

| Column | Meaning |
| --- | --- |
| `record_id`, `created_at`, `created_by` | ID, creation timestamp, who or what created it |
| `first_name`, `last_name`, `email_addresses`, `phone_numbers`, `linkedin_url` | Identity and channels, multi-valued where comma-separated |
| `job_title` | Free text |
| `category` | `Practitioner`, `Administrative`, `Support`, `President` |
| `type` | Role in the deal: `Decision Maker`, `User`, `Champion`, `Deployment contact`, multi-valued |
| `specialty` | Medical specialty |
| `company_record_id` | Account the person is attached to |
| `rpps` | French national practitioner ID, 11 digits, practitioners only |

## `sales_team.csv`

| Column | Meaning |
| --- | --- |
| `user_id`, `name`, `role`, `market` | Role is AE, SDR or AM (account manager); Ops and CS people appear because they own a few deals |
| `start_date`, `status`, `end_date` | Tenure. `Left` means the person has left the team |
| `monthly_new_arr_quota_synthetic`, `monthly_demos_held_target_synthetic` | **Made up for this exercise.** The CRM does not hold quotas, and these are not our real targets. Use them, change them or ignore them, and tell us which you did |
