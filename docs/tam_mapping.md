# Part 1B · Mapping the TAM

> **Three choices.** (1) The account is the **site**: one SIRET, one booking calendar, the unit Vocca deploys and bills. Sites roll up to a **group** (where the decision and the framework contract sit) and a **network**; the **legal entity** (SIREN) is linked, not used as the hierarchy. (2) The **master record lives in the warehouse**, built from public registries; Attio is the operational copy. (3) **Nothing that touches a customer or two sales owners is merged by a machine.**
>
> Real work on the file: [`scripts/tam_dedup.py`](../scripts/tam_dedup.py) applies this model to the 5,080 accounts and produces the action lists in [`out/tam/`](../out/tam/).

---

## 1. What is wrong today

Full list with every number: [`docs/data_findings.md`](data_findings.md). The issues that matter most for a market map:

| Problem | Size | Why it matters |
|---|---|---|
| Identity key unusable | 761 SIRENs typed in the SIRET field, 485 empty, 15 malformed: **25% of accounts have no site identifier** | Matching falls back on names and phones, which is where duplicates come from |
| Duplicates | **115 records** are certain duplicates (same SIRET, or same SIREN + name + postcode, or same booking calendar + a second key); 132 more pairs need a human | Two owners working the same practice; inflated TAM and pipeline |
| Duplicates are produced by automations | Of the 115, **43 were created by the enrichment pipeline**, 11 by n8n, 11 by email sync | Inserts instead of upserts: cleaning once will not last |
| Hierarchy broken | 3 records are their own parent, 36 impossible parent types (e.g. a group under a practice), 53 "practices" with several sites, 112 empty groups, 65 accounts without a type | Group roll-outs and account plans cannot be read from the CRM |
| ARR counted twice | **426 sites carry ARR while their group carries it too** (€8.8M customer ARR at risk of double counting) | Revenue reporting is wrong as soon as you sum a hierarchy |
| Lifecycle and billing out of sync | 334 accounts without lifecycle; a Hyperline ID on 204 non-customers; 188 customers without ARR | Cannot separate "in the TAM, not worked" from "customer" reliably |
| Contacts on the wrong account | **247 contacts** whose work-email domain belongs to another account family; 2,439 contacts parked on a group instead of their site | Outreach and champions mapped to the wrong practice |
| Junk enrichment | Practice "websites" such as doctolib.fr, maiia.com, pagesjaunes.fr, gmail.com; 30 SIRETs failing the checksum | Enrichment writes whatever it finds, unchecked |

## 2. The model

### What an account is

| Object | Definition | Key | Why it exists |
|---|---|---|---|
| **Site** (the account) | One physical place where patients book: a practice, a health centre, an imaging centre, a clinic | SIRET (14 digits) | The unit Vocca integrates with (one booking calendar), prices (practitioners / machines) and deploys. Group roll-out deals are per site |
| **Group** | Several sites under one decision maker; where the framework contract is signed | Internal ID; SIREN when the group is itself a legal entity | 1,728 sites already sit under 310 groups; the decision is taken here |
| **Network** (Superorga) | A network of groups (e.g. a national imaging or clinic chain) | Internal ID | Account planning above group level |
| **Legal entity** | The company behind a site or a group | SIREN (9 digits) | Contracts and invoices. **Linked, not a level of the hierarchy**: 314 SIRENs run several sites, and 689 sites sit under a group whose SIREN differs from theirs (a group of separate SCMs) |
| **Practitioner** | A person working at one or more sites | RPPS (11 digits) | Pricing driver and champion; can work at several sites |

Rules that follow from it: **ARR and billing IDs live on sites only** (group ARR = sum of its sites). Contacts attach to the site where they work; group-level contacts (a CEO, a purchasing lead) attach to the group.

### The match key

1. **SIRET**, validated: 14 digits, Luhn checksum, establishment active in the SIRENE registry.
2. If no SIRET: **booking-calendar URL** (Doctolib / Maiia page), unique per site and present on 1,517 accounts.
3. Then **FINESS** (health centres, clinics), **normalised phone**, **website domain** (platforms and webmail excluded), **normalised name + postcode**.
4. US: **NPI** (organisation) from the NPPES registry, the SIRET equivalent.

### What I refuse to merge automatically, and why

| Case | Decision | Why |
|---|---|---|
| Same SIREN, different SIRETs | Never merge; link both sites to one legal entity | Two sites of one company are two deployments |
| A site and a group sharing an identifier | Never merge; attach the site to the group | That is the group's head-office site, or a missing hierarchy link |
| Either record is a customer (billing ID, ARR, Customer/Churn) | Manual review | Merging moves invoices and ARR: a human signs it off |
| Open deals owned by two different people | Manual review | It is an ownership decision, not a data one |
| Shared phone, domain or name only | Never merge | Groups share switchboards and domains legitimately; names repeat ("Clinique Nice") |
| Same calendar URL only, or same name + postcode without SIRET | Manual review | Strong hint, not proof |

**Survivor rule** when merging: customer first, then the record with the most deals, then the most contacts, then the most complete, then the oldest.

## 3. Real work on the file

`python scripts/tam_dedup.py data out/tam` (runs in 2 seconds):

| Output | Result |
|---|---|
| `merge_clusters.csv` | **5,080 → 4,965 accounts**: 115 records merged into 113 survivors (86 leads, 25 without lifecycle, 4 prospects; no customer touched) |
| `merge_pairs.csv` | Every candidate pair with the keys it shares, the decision and the reason in plain words: 117 auto-merge, **132 manual review** (70 involve a customer, 39 same name + postcode without SIRET, 19 missing type, 4 same calendar only), 40 hierarchy fixes, 5,241 refused (mostly sites sharing a SIREN) |
| `hierarchy_issues.csv` | 771 issues with a proposed action: 426 ARR on site and group, 112 empty groups, 76 single-site groups, 65 missing types, 53 practices that are groups, 36 impossible parent types, 3 self-parents |
| `contact_moves.csv` | **247 contacts** to re-attach (244 on the wrong account family, 3 without any company) |

The rules were tuned on real pairs from the file. Two examples of what the script gets right: "Scanner IRM du Cours" exists twice with the same SIREN, name and postcode (merged); four imaging sites share the SIREN of "Radiys Radiologie" while one of them is not attached to it (hierarchy fix, not a merge).

## 4. The build

### Sources

| Source | What it gives | Access |
|---|---|---|
| **SIRENE** (INSEE) | Every establishment (SIRET) and legal unit (SIREN): address, NAF code, legal form, active/closed, head office | Open data, API and monthly stock file, daily updates |
| **Annuaire Santé / RPPS** (Agence du Numérique en Santé) | Every practitioner, specialty, and where they practise (with the structure's identifiers) | Open data extracts, refreshed frequently |
| **FINESS** | Health centres, clinics, hospitals, with legal entity and establishment numbers | Open data |
| **Booking platforms** (Doctolib, Maiia) | Calendar URL, practitioner count, specialties, booking software: the integration effort | Public pages; to be checked with legal before any systematic collection |
| **Enrichment vendors** (e.g. Dropcontact, Kaspr, Lusha) | Decision-maker emails and phones | Paid, per contact; write to contacts only, never create accounts |
| **US**: NPPES (NPI), state licensing boards | Organisations and practitioners | Open data |

The TAM itself is built from the registries, not from the CRM: every site with a target specialty and structure type, scored, then flagged "in Attio / not in Attio".

### Where the master record lives

**In the warehouse.** The golden `site`, `group`, `legal_entity` and `practitioner` tables are built there (dbt models: ingest registries → normalise → match → survivorship), because matching across 100k+ registry rows, keeping history and testing rules does not belong in a CRM.

**Attio is the operational copy.** A daily sync (n8n, or a reverse-ETL tool) pushes accounts, hierarchy and keys into Attio; Attio writes back only the fields Sales owns (owner, lifecycle, notes). Every Attio record carries the master ID.

### Keeping it fresh

| What | Cadence |
|---|---|
| SIRENE changes (closures, moves, new sites) | Daily API delta, monthly full reconciliation |
| RPPS / Annuaire Santé | Weekly |
| Booking-platform attributes | Monthly on targeted segments |
| Matching and survivorship run | Nightly in the warehouse |
| Manual review queue | Owned by RevOps, reviewed weekly, SLA one week |

### Measuring that it is clean, and stopping it degrading

**Data-quality KPIs** (one dashboard, weekly): % of sites with a valid active SIRET, duplicate pairs open, manual queue size and age, hierarchy violations, % of contacts on the right account, % of customers whose billing ID matches Hyperline, ARR reconciliation Attio vs Hyperline.

**Gates that prevent new mess:**
- SIRET as a **unique attribute** in Attio, required for any account at Prospect stage or beyond.
- Every automation (enrichment, n8n, email sync) **upserts on the match key**; none may create an account without a lookup first. Email sync attaches contacts, it does not create companies.
- A creation webhook checks the warehouse before a new account is saved and proposes the existing one.
- dbt tests fail the nightly run on cycles, impossible parent types or ARR on two levels.

### Automated vs manual

| Automated | Manual |
|---|---|
| Normalisation, SIRET validation, registry lookups | Merges involving a customer or two owners |
| Merges on exact SIRET (non-customers) | Re-typing a practice into a group, splitting a group |
| Hierarchy from shared SIREN where unambiguous | Disputed group ownership (a site claimed by two groups) |
| Contact re-attachment when the email domain is unique | Contacts whose domain is shared by several accounts |
| Enrichment of empty fields | Overwriting a field a salesperson filled by hand |

## 5. Recommendations

| Priority | What | Why first | Effort |
|---|---|---|---|
| **P0 · Stop the bleeding** | SIRET unique in Attio; enrichment / n8n / email sync switched to upsert-on-key; creation lookup | Otherwise every clean-up is undone within weeks | Week 1 |
| **P0 · Fix what breaks reporting** | Run the 115 automatic merges; move ARR to sites only (426); break the 3 cycles and 36 impossible parents | Revenue and pipeline numbers are wrong today | Week 1-2 |
| **P1 · Master record** | Warehouse models: SIRENE + RPPS + FINESS ingestion, matching, survivorship, sync to Attio | One source of truth, refreshed, with history | Weeks 2-5 |
| **P1 · Clear the queue** | 132 manual pairs, 38 sites to attach, 53 practices to re-type, 247 contacts | Small enough to finish in a few days with Sales | Weeks 2-3, about 3 days of work |
| **P2 · Size and score the TAM** | Full universe from registries by specialty, structure type and booking software; score; flag "not in Attio" | Feeds territory design and outbound for the 3x plan | Weeks 5-7 |
| **P2 · US** | Same model on NPI, before the US base grows | Cheap now, expensive after 1,000 accounts | Weeks 6-8 |
| **P3 · Run it** | Data-quality dashboard, weekly review, dbt tests | Keeps it clean without heroics | Ongoing |

**Rough plan: 6 to 8 weeks for one person**, with P0 delivering visible value in the first two weeks.

## 6. With a week and a warehouse

- Join the file to SIRENE and RPPS for real: validate every SIRET, recover the 761 SIRETs hidden behind a SIREN, and size the true addressable universe instead of the 3,164 leads already in the CRM.
- Replace the hand-tuned rules with a scored matcher (weighted keys, thresholds set on a labelled sample from the manual queue) and measure precision and recall.
- Turn the script into dbt models with tests, so the cleaning runs every night instead of once.
