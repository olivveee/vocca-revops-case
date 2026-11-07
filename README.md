# Vocca · Senior RevOps case study

Work for Part 1A (sales efficiency dashboard) of the Vocca Senior RevOps case.

- **Google Sheet (the deliverable and the back-office):** https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit
- **Web view (`web/`):** a read-only visual layer on top of the same sheet.

## How the pieces fit

```
Attio export (CSV)  ->  Google Sheet  ->  web page
                        RAW_*           (reads DEALS_CLEAN, RAW_team, WEB_PARAMS
                        DEALS_CLEAN      published as CSV; no business rule lives here)
                        PARAMS
                        CALC
                        DASHBOARD
                        DATA_QUALITY
```

- **The sheet owns everything:** raw data, cleaning rules (`DEALS_CLEAN`, all `ARRAYFORMULA`s), the recalibrated quota, the thresholds (`PARAMS`). Change a quota or a threshold there and both the `DASHBOARD` tab and the web page follow.
- **The web page only displays.** It fetches three published tabs at load time, so a change in the sheet reaches the page once Google republishes (a few minutes).
- **The Python scripts were exploration only:** they profiled the export and sized the data-quality issues before anything was built. No dashboard number is computed in Python.

## Repository layout

| Path | What it is |
| --- | --- |
| `data/` | The anonymised CRM export provided for the case, with its data dictionary (`data/README.md`) |
| `docs/data_findings.md` | What is wrong in the export, sized with numbers (dashboard and TAM) |
| `scripts/` | Exploration scripts used to audit the export and test candidate metrics |
| `web/` | Static web dashboard (HTML/CSS/JS, no build step, no dependency) |

## Metrics, and what was left out

Kept, grouped by the three questions a Head of Sales asks on Monday morning:

1. **Are we on track?** New-logo ARR vs quota (group rollouts counted as expansion), healthy weighted pipe.
2. **Who needs help?** Win rate on 3 rolling months with the July bulk clean-up counted as losses, demo-to-won rate, average deal.
3. **Why?** Share of unhealthy open deals (older than 90 days, or next step / expected close more than 30 days late), clean-up losses per AE.

Left out on purpose: sales cycle length (deals are created late, often at signature), the AEs' closing probability (half empty, uncalibrated), activity volume (not in the export), SDR metrics (demo attribution is broken). The `README` and `DATA_QUALITY` tabs of the sheet explain each choice.

**Quota:** the synthetic quotas put every AE at 150-600%, so they were replaced by the median monthly new-logo ARR of tenured AEs over the last 6 complete months, with a 25/50/75/100% ramp-up. A top-down quota can be typed in `PARAMS` and overrides it.

## Running the scripts

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/profile.py data
.venv/bin/python scripts/checks_deals.py data
.venv/bin/python scripts/checks_accounts.py data
.venv/bin/python scripts/checks_extra.py data
.venv/bin/python scripts/metrics_test.py data
```

## Running the web page locally

```bash
python3 -m http.server 4173 --directory web
```

Then open http://localhost:4173. The page reads the published sheet configured in `web/config.js`.

## Deploying on Vercel

Import the repository in Vercel and set **Root Directory = `web`**. No build command, no output directory: it is a static site. `web/vercel.json` sets `X-Robots-Tag: noindex`.

## With a week and a warehouse

- Fix the source, not the report: mandatory `signed_date`, `signed_arr` and `loss_reason` at Closed Won / Lost in Attio, `close_date` no longer used as an expected date, next steps enforced on open deals, group rollouts typed correctly at creation.
- Sync Attio to the warehouse daily and move the `DEALS_CLEAN` rules into a tested SQL / dbt model; the sheet or a BI tool reads the final table.
- Use stage-change history for a real funnel and cycle time, and calibrate stage weights on observed conversion.
