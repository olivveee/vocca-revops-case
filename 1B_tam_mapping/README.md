# 1B · Mapping the TAM

| Deliverable | Link |
| --- | --- |
| **Slides** (4, in French) | [Open the slides](https://vocca-revops-case.vercel.app/slides.html) |
| **Write-up**: what is wrong, the account model, the build, recommendations | [`tam_mapping.md`](tam_mapping.md) |
| **TAM cockpit**: work queues, explorer, quality by source, pair review | [Open the cockpit](https://vocca-revops-case.vercel.app/tam.html) |
| **Action pack** (Excel) | [Download](https://vocca-revops-case.vercel.app/data/tam_action_pack.xlsx) |

## In this folder

| File | What it is |
| --- | --- |
| [`tam_mapping.md`](tam_mapping.md) | The 1B write-up |
| [`data_findings.md`](data_findings.md) | What is wrong in the companies and contacts base, sized |
| [`tam_dedup.py`](tam_dedup.py) | The work on the file: generic identity, deduplication, hierarchy audit, contact re-attachment, work queues |
| [`output/`](output/) | Its outputs: every candidate pair with its decision and reason, merge clusters, hierarchy and market issues, contact moves, summary |
| [`exploration/`](exploration/) | The checks run on the base before the model was built |

The script also writes the feed of the cockpit and the slides, and the action pack, in `web/data/`: the slides, the cockpit and the Excel file always show the same numbers.

```bash
python 1B_tam_mapping/tam_dedup.py data 1B_tam_mapping/output web/data
```
