# 1A · Sales efficiency dashboard

The deliverable is the **Google Sheet**: [open it](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit). Every number is a formula on the raw export; nothing in this folder computes a dashboard number.

| Tab | What it holds |
| --- | --- |
| [`DASHBOARD`](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=102) | Four numbers (new-logo ARR vs quota, expansion ARR, weighted healthy pipe, win rate), pipe by stage, one line per AE with a flag |
| [`WHAT_WORKS`](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=108) | Won ARR, win rate and open pipe by country, motion, stage, source and specialty |
| [`DATA_QUALITY`](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=103) | The numbers not to trust, counted live, and what the dashboard does about each |
| [`PARAMS`](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=104) | Every setting in one place: quota, currency and rate, thresholds, stage weights, ramp-up |
| [`README`](https://docs.google.com/spreadsheets/d/15gDvbv-UHpQrvqLaG8rC6UI93rJtEb1nnbNSiZPjwug/edit#gid=101) | How to read and maintain the file |
| `DEALS_CLEAN`, `CALC`, `RAW_*`, `WEB_PARAMS` | Cleaning rules, quota calibration base, the export pasted as is, and the feed of the web view |

**Web view** of the same Sheet: [vocca-revops-case.vercel.app](https://vocca-revops-case.vercel.app/) (source in [`../web/`](../web/): `index.html`, `app.js`).

## In this folder

| File | What it is |
| --- | --- |
| [`data_findings.md`](data_findings.md) | What is wrong in the deals export, sized, and how the dashboard handles each issue |
| [`exploration/`](exploration/) | The scripts used to profile the export and test candidate metrics before the Sheet was built |

```bash
python 1A_sales_dashboard/exploration/profile.py data
```
