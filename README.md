# Vocca · Senior RevOps case study

Part 1 of the Vocca Senior RevOps case: **1A**, a sales efficiency dashboard for the Head of Sales, and **1B**, mapping the TAM. Everything below runs on the anonymised Attio export provided for the case (`data/`).

## Deliverables

### 1A · Sales efficiency dashboard

| What | Link |
| --- | --- |
| **Google Sheet** (the deliverable, shared as editor) | [Open the Sheet](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit) |
| ↳ `DASHBOARD`: four numbers, pipe by stage, one line per AE | [Tab](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=102) |
| ↳ `WHAT_WORKS`: won ARR and win rate by country, motion, stage, source, specialty | [Tab](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=108) |
| ↳ `DATA_QUALITY`: the numbers not to trust, and what the dashboard does about them | [Tab](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=103) |
| ↳ `PARAMS`: every setting in one place (quota, currency, thresholds) | [Tab](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=104) |
| ↳ `README`: how to read and maintain the file | [Tab](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=101) |
| **Web view** of the same Sheet (read-only) | [vocca-revops-case.vercel.app](https://vocca-revops-case.vercel.app/) |
| What is wrong in the export, sized | [`docs/data_findings.md`](docs/data_findings.md) |

### 1B · Mapping the TAM

| What | Link |
| --- | --- |
| **Slides** (4, in French: what is wrong, the model, the build, recommendations) | [Open the slides](https://vocca-revops-case.vercel.app/slides.html) |
| **Write-up**: account model, generic identity, build, recommendations | [`docs/tam_mapping.md`](docs/tam_mapping.md) |
| **TAM cockpit**: the work tool built on the file | [Open the cockpit](https://vocca-revops-case.vercel.app/tam.html) |
| ↳ Work queues: duplicates, identity, structure, market, contacts | [Tab](https://vocca-revops-case.vercel.app/tam.html#queues) |
| ↳ Explorer: every record behind a queue, filterable, CSV export | [Tab](https://vocca-revops-case.vercel.app/tam.html#explore/all) |
| ↳ Quality by source: which tool creates the mess | [Tab](https://vocca-revops-case.vercel.app/tam.html#sources) |
| ↳ Pair review: 211 pairs to merge or keep separate | [Tab](https://vocca-revops-case.vercel.app/tam.html#review) |
| **Action pack** (Excel: every merge, review pair, hierarchy fix, contact move) | [Download](https://vocca-revops-case.vercel.app/data/tam_action_pack.xlsx) |
| The script that does the work on the file | [`scripts/tam_dedup.py`](scripts/tam_dedup.py), outputs in [`out/tam/`](out/tam/) |

### 2 · A project I ran

| What | Link |
| --- | --- |
| **Support slides** (4, in French: qualified prospect lists delivered to every sales rep) | [Open the slides](https://vocca-revops-case.vercel.app/partie2.html) · [PDF](https://vocca-revops-case.vercel.app/partie2.pdf) |

Part 3 is live, with no material.

## 1A in short

The dashboard answers, in order, the questions a Head of Sales asks on Monday morning:

1. **Are we on track?** New-logo ARR vs quota, expansion ARR, weighted healthy pipe, win rate; then the open pipe by stage with its unhealthy share (older than 90 days, or next step / expected close more than 30 days late).
2. **What works?** Won ARR and win rate by source and by specialty.
3. **Who needs help?** One line per AE: new-logo ARR vs quota, win rate, healthy pipe, and a flag that says why (below quota, low conversion, pipe needs cleaning, does not close out losses).
4. **What not to trust:** the `DATA_QUALITY` tab, live counts with the handling of each issue.

Choices worth knowing:

- **Country is the account's, not the AE's:** the French team owns almost every deal, US accounts included. The quota is compared with what the country's own team signed.
- **Group rollouts typed `New` are counted as expansion**, and the July bulk clean-up (145 deals closed lost in one sweep) is counted as the AE's losses, with the win rate without it shown next to it.
- **Quota:** the synthetic quotas of the team file put every tenured AE at about 170-480%, so by default the quota is recalculated: median monthly new-logo ARR of tenured AEs over the last 6 complete months, with a 25/50/75/100% ramp-up. `PARAMS` > Quota used switches back to the provided quotas to compare, and a top-down target typed in `PARAMS` overrides both.
- **One reporting currency, USD by default:** deals come in EUR (1,469) or USD (37). The EUR→USD rate is fixed in `PARAMS` (1.1145, rate of 8 Nov 2026) so the Sheet and the web view match; clearing it switches to the live Google Finance rate in the Sheet.
- **Left out on purpose:** sales cycle length (deals are created late, often at signature), the AEs' closing probability (half empty, uncalibrated), activity volume (not in the export), SDR metrics (demo attribution is broken).

## How the pieces fit

```
Attio export (CSV)  ->  Google Sheet                         ->  web view
                        RAW_*         export, pasted as is        reads DEALS_CLEAN, RAW_team and
                        DEALS_CLEAN   one row per deal, formulas  WEB_PARAMS, published as CSV;
                        PARAMS        every setting               no business rule lives here
                        CALC          quota calibration base
                        DASHBOARD, WHAT_WORKS, DATA_QUALITY

data/  ->  scripts/tam_dedup.py  ->  out/tam/*.csv
                                 ->  web/data/ (TAM cockpit feed, action pack)  ->  slides and cockpit
```

- **The Sheet owns 1A:** raw data, cleaning rules (`DEALS_CLEAN`, all `ARRAYFORMULA`s), quota and thresholds (`PARAMS`). Change a setting there and the dashboard tabs and the web view follow; the web view updates once Google republishes (a few minutes). `WEB_PARAMS` only relays `PARAMS` to the web view.
- **The script owns 1B:** the slides, the cockpit and the action pack all read its output, so they always agree.
- **The other Python scripts were exploration only:** they profiled the export and sized the issues before anything was built. No dashboard number is computed in Python.

## Repository layout

| Path | What it is |
| --- | --- |
| `data/` | The anonymised CRM export provided for the case, with its data dictionary (`data/README.md`) |
| `docs/data_findings.md` | What is wrong in the export, sized (dashboard and TAM) |
| `docs/tam_mapping.md` | 1B write-up |
| `scripts/tam_dedup.py` | 1B work on the file: deduplication, hierarchy audit, contact re-attachment, work queues |
| `scripts/profile.py`, `checks_*.py`, `metrics_test.py` | Exploration scripts used to audit the export and test candidate metrics |
| `out/tam/` | Output of `tam_dedup.py`: merge pairs and clusters, hierarchy and market issues, contact moves, summary |
| `web/` | Static site (HTML/CSS/JS, no build step): 1A web view (`index.html`), TAM slides (`slides.html`), TAM cockpit (`tam.html`) |

## Running it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python scripts/tam_dedup.py data out/tam web/data   # refreshes the cockpit feed and the action pack
python3 -m http.server 4173 --directory web                  # then open http://localhost:4173
```

The exploration scripts take the data folder as argument (`.venv/bin/python scripts/profile.py data`). The 1A web view reads the published Sheet configured in `web/config.js`.

**Vercel:** import the repository with **Root Directory = `web`**, no build command. `web/vercel.json` sets `X-Robots-Tag: noindex`.

## With a week and a warehouse

- Fix the source, not the report: mandatory `signed_date`, `signed_arr` and `loss_reason` at Closed Won / Lost in Attio, `close_date` no longer used as an expected date, next steps enforced on open deals, group rollouts typed correctly at creation, a generic company identity validated per country.
- Sync Attio to the warehouse daily; move the `DEALS_CLEAN` rules and `tam_dedup.py` into tested SQL / dbt models; the Sheet or a BI tool reads the final tables.
- Use stage-change history for a real funnel and cycle time, and calibrate stage weights on observed conversion.
