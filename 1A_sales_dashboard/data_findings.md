# 1A · What is wrong in the deals export (Attio, 2026-09-25)

Volumes: 1,506 deals and 28 people in `sales_team`. Sized with the scripts in [`exploration/`](exploration/) (`profile.py`, `checks_deals.py`, `checks_extra.py`, `metrics_test.py`). The `DATA_QUALITY` tab of the Google Sheet keeps these counts live and says what the dashboard does about each one.

## Numbers that cannot be taken at face value

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
| 13 | Open-pipe hygiene: 288 deals older than 90 days, 311 with an overdue next step, 227 without one, 99 with an expected close in the past; only 1 open deal has a next step in the future | out of 539 | These become dashboard metrics |
| 14 | 37 deals in USD, only 2 owned by the US AE; the other 1,469 are in EUR | 37 | Every amount converted to one reporting currency (USD by default; EUR→USD rate fixed in PARAMS at 1.1145, or live from Google Finance when the cell is cleared) |
| 15 | Uneven history: 1 deal in May 2025, 6 in April 2025 | early 2025 | Probably incomplete history; excluded from trends |
| 16 | Specialty taxonomy: Ophtalmology / Ophthalmology, Chirurgy / Surgery, lowercase "rhumatology" | 29 values | Needs a mapping table |
| 17 | Deals on companies missing from the export (3) or without `type` (19) | 22 | Minor |
