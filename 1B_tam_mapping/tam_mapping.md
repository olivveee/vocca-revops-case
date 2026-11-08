# Part 1B · Mapping the TAM

> **Three choices.**
> 1. **One account model for every market.** The account is the **site**: the place patients book, the unit Vocca deploys and bills. Sites roll up to a **group** (where the decision and the framework contract sit) and a **network**. The **legal entity** is linked to sites, not used as the hierarchy.
> 2. **One generic identity in the CRM.** Attio carries `country` + `company_number` + `company_number_type` (SIRET in France, NPI in the US…), validated per type, and that is the main dedupe key: without a validated number, a machine only merges when two keys agree (same calendar plus a second key, or same SIREN, name and postcode). Market-specific columns and sources live upstream, in the warehouse, which joins them into this shape.
> 3. **A machine only merges two records of the same site: same identifier, same postcode, no customer, one salesperson.** Everything else goes to a person.
>
> Real work on the file: [`tam_dedup.py`](tam_dedup.py) applies this model to the 5,080 accounts and produces the action lists in [`output/`](output/). The [TAM cockpit](https://vocca-revops-case.vercel.app/tam.html) turns the result into work queues: each opens onto the detailed list of records with the reason, the next action and the rule, plus a quality-by-source view and the pair review.

---

## 1. What is wrong today

Full list with every number: [`data_findings.md`](data_findings.md). The issues that matter most for a market map:

| Problem | Size | Why it matters |
|---|---|---|
| No usable identity | **25% of accounts** have no validated company number: in France 756 SIRENs typed in the SIRET field and 220 empty; in the US **167 of 175** accounts have no number at all | Matching falls back on names and phones, which is where duplicates come from |
| No field for a foreign identity | The 8 US accounts that have a number carry it in the French `siret` field, typed by hand (7 by one French AE); none passes the NPI check (10 digits, starting with 1 or 2, check digit), and the anonymised export probably scrambled them | The CRM was built for France only: there is nowhere to store a US identity, so US accounts cannot be deduplicated |
| Duplicates | **91 records** are certain duplicates; 239 more pairs need a human (53 of them share a SIRET but not a postcode: one number was copied onto the wrong account) | Two owners working the same practice; inflated TAM and pipeline |
| Duplicates are produced by tools, not people | Of the 91, **27 were created by the enrichment pipeline**, 11 by email sync, 9 by n8n; of the 450 contacts without an account, 432 were created by telephony, email sync or enrichment | The tools are connected but not orchestrated: they insert instead of upserting, so cleaning once will not last |
| No clear structure | **65 accounts without type**; 53 "practices" with several sites; 14 accounts attached to a practice (9 practices, 5 groups); 3 self-parents; **60 multi-site organisations with no group** (e.g. 3 US sites in 3 cities sharing one domain). Groups under a group are fine (sub-groups of a larger one). Open questions rather than errors: 112 empty groups, 76 single-site groups | To deploy a group tomorrow, nobody can tell from the CRM which structure to set up |
| Market not set | 118 accounts without country (all French postcodes); 67% of US accounts without lifecycle. 47 US accounts are still owned by the French team, which is expected (the first US AE started in July 2026): they go to the reassignment queue | Territories and US pipeline cannot be read by market |
| No shared definition of what counts | **101 investors, partners and media** in the same object as prospects (41 in the US), 65 accounts without type; nothing separates the TAM, the SAM and accounts outside the market | They inflate the TAM and the lead counts, and two people asked "how big is our market" get two answers |
| Junk enrichment | Practice "websites" such as doctolib.fr or gmail.com (60); **doctolib.fr booking pages on US accounts** (8), a platform that does not operate there | Enrichment writes whatever it finds, unchecked |
| Contacts on the wrong account | **160 contacts** whose work-email domain belongs to another account family; 450 without company. Another 47 sites have contacts using their network's domain: the site is missing its parent link, the contacts are where they should be | Outreach and champions mapped to the wrong practice |

## 2. The model, as the CRM sees it

### Objects

| Object | Definition | Why it exists |
|---|---|---|
| **Site** (the account) | One physical place where patients book: a practice, a health centre, an imaging centre, a dental office, a clinic | The unit Vocca integrates with (one calendar), prices (practitioners / machines) and deploys. Group roll-out deals are per site |
| **Group** | Several sites under one decision maker: a radiology group, a dental group (DSO in the US), a health system | Where the decision is taken and the framework contract is signed |
| **Network** | A network of groups (a national chain) | Account planning above group level |
| **Legal entity** | The company behind sites or a group | Contracts and invoices. Linked, not a level: in France 314 legal entities run several sites, and 689 sites sit under a group whose legal entity differs from theirs |
| **Practitioner** | A person working at one or more sites | Pricing driver and champion |

Rules that follow: a site generates the revenue and a group is the sum of its sites. Groups can nest; every account carries its **ultimate parent** (the top of its chain) so a group is read in one place. Sites are attached to their legal entity (SIRET to SIREN) automatically. Contacts attach to the site where they work; group-level contacts attach to the group.

### What counts in the market

| Scope | Definition | Where it lives |
|---|---|---|
| **TAM** | Every site of a target specialty and structure type in a market, known to us or not | Warehouse, built from the registries, scored |
| **SAM** | What we actually address: in the ICP, in a market we cover, with a team to work it | Attio, pushed when a team takes it on |
| **Outside the market** | Investors, partners, media | Attio, with their own `business_relationship_type`; never counted in the TAM or SAM |

Every account carries a type (site, group, network) and a relationship type; both are required.

### One generic identity, validated per market

Attio does not get a column per country. It gets generic fields, filled from whichever registry applies:

| Generic CRM field | France | United States | Other markets |
|---|---|---|---|
| `country` | ISO code (inferred from the postcode when missing) | ISO code | ISO code |
| `company_number` + `company_number_type` (site) | SIRET (14 digits, checksum, active) | NPI of the organisation (10 digits, check digit) | National business / establishment number, to confirm per country |
| `legal_entity_number` | SIREN | No public national registry: legal name + state of registration | Per country |
| `practitioner_number` (on contacts) | RPPS | Individual NPI | Per country |
| Fallback keys, same everywhere | Booking-calendar URL, normalised address, name + postcode | | |
| Group signals, not identity keys | Phone and website domain: groups share switchboards and domains, so they detect groups instead of duplicates | | |

A number only counts as identity once it passes its type's validation; until then it is stored but ignored by matching. That single rule is what would have kept the US numbers out of the dedupe.

### What I refuse to merge automatically, and why

| Case | Decision | Why |
|---|---|---|
| Two different validated company numbers | Never merge; link both sites to their legal entity | Two sites of one company are two deployments (98% of these pairs share only the SIREN) |
| Two different validated numbers with the same calendar or name + postcode | Manual review | One number is probably outdated or mistyped (75 pairs) |
| The same number in two different postcodes | Manual review | A site is one place: the number was copied onto the wrong account, or the site moved (53 pairs) |
| A site and a group sharing an identifier | Never merge; attach the site to the group | Head-office site or a missing hierarchy link |
| Either record is a customer | Manual review | Merging moves invoices and ARR |
| Two different salespeople (account owner or open deals) | Manual review | Ownership decision, not a data one |
| Shared phone or domain only | Not a duplicate: a group signal | Groups share switchboards and domains; on this file 47 of the 48 phone-only pairs are in different cities. A domain shared across cities is a **group to create** |
| Same calendar URL only, or same name + postcode without a number | Manual review | Strong hint, not proof |
| Account type missing on one record | Manual review | Without a type the model cannot tell a duplicate from a site under its group (22 pairs) |

**Merged automatically**: same validated number (62 pairs), same calendar plus a second key (20), same SIREN, name and postcode (9); always in the same postcode, never a customer, never two salespeople.

**Survivor rule**: customer first, then most deals, most contacts, most complete, oldest.

## 3. Real work on the file

`python 1B_tam_mapping/tam_dedup.py data 1B_tam_mapping/output web/data` (runs in a few seconds):

| Output | Result |
|---|---|
| `merge_clusters.csv` | **5,080 → 4,989 accounts**: 91 records merged into 91 survivors, all in the same postcode, no customer touched, never two salespeople |
| `merge_pairs.csv` | Every candidate pair with the keys it shares, the decision and the reason: 91 auto-merge, **239 manual review** (75 two valid numbers with the same calendar or address, 53 same number in two postcodes, 43 involve a customer, 36 same name + postcode without number, 22 missing type, 7 two salespeople, 3 same calendar only), 40 hierarchy fixes, 5,158 refused (mostly sites sharing a legal entity) |
| `hierarchy_issues.csv` | Each issue with a severity and a proposed action. Errors: 65 accounts without type, 53 practices that are groups, 47 sites or groups outside their network (their contacts use the network's email domain), 17 impossible parents (14 under a practice), 3 self-parents. Questions to settle with Sales: 112 empty groups, 76 single-site groups |
| `market_issues.csv` | 356 market issues: 118 countries inferred, 101 out-of-TAM accounts, 60 multi-site organisations without group, 47 accounts owned by the other market's team, 16 unverified foreign numbers, 12 booking URLs from the wrong country |
| `contact_moves.csv` | **163 contacts** to re-attach (160 on another account family, 3 without account). A contact on a site whose email domain is its network's stays put: the site is attached instead |
| `tam_action_pack.xlsx` | All of the above in one workbook, plus the rules |

Two examples the rules get right: "Scanner IRM du Cours" exists twice with the same legal entity, name and postcode (merged); "Cabinet de Masso-Kinésithérapie Bordeaux - site 2" shares a calendar with "Cabinet de Masso-Kinésithérapie Bordeaux" (sent to review: it may be a real second site); "Centre Cardiologique Océane" in Guadeloupe and "Cabinet de Cardiologie Schmitt" near Toulouse share a SIRET (sent to review: one of the two numbers is wrong).

## 4. The build

### Why a warehouse, in one paragraph

Each market brings its own registries, booking platforms, enrichment vendors and identifier formats, plus Attio and Hyperline. Joining them, keeping history and testing matching rules is a data-engineering job: it belongs in the warehouse (being built), where source-specific columns (`siret`, `npi`, `rpps`…) are mapped into the generic model above. Attio receives the result. I would not detail the pipelines here: the point is that the CRM only ever sees one model.

### Sources, by market

| Market | Sites and legal entities | Practitioners | Booking / practice data |
|---|---|---|---|
| France | SIRENE (INSEE), FINESS for health centres and clinics | Annuaire Santé / RPPS | Doctolib, Maiia public pages (to clear with legal before systematic collection) |
| United States | NPPES (NPI registry, organisations), CMS provider data linking clinicians to group practices | NPPES (individual NPI), state licensing boards | Practice websites; paid healthcare data vendors for group and DSO structures |
| Every market | Enrichment vendors write to **contacts** only and never create accounts | | |

The TAM is built from the registries, not from the CRM, in four steps:

| Step | What it does |
|---|---|
| **Normalise** | Country, address, phone, company number validated per type, in the generic model |
| **Structure** | Deduplicate, attach each site to its legal entity and group (SIRET to SIREN to group), compute the ultimate parent |
| **Segment** | Market, specialty, structure type (practice, health centre, imaging, dental group…), size (practitioners, sites, machines) |
| **Score** | ICP fit (specialty, structure type, online booking calendar, part of a group) times potential (practitioners or machines, the pricing driver), giving a priority per site and per group that feeds territories and outbound |

Each site is then flagged "customer / in Attio / not in Attio". The score weights start as a judgement call and are recalibrated on won and lost deals once the model runs.

### Where the master record lives

**The TAM in the warehouse, the SAM in Attio.** Golden `site`, `group`, `legal_entity` and `practitioner` tables, rebuilt nightly (ingest → normalise → match → survivorship). **Attio is the operational copy**: a daily sync pushes accounts, hierarchy and the generic identity; Attio writes back only the fields Sales owns (owner, lifecycle, notes). Every Attio record carries the master ID.

### Keeping it fresh

| What | Cadence |
|---|---|
| Registry changes (SIRENE, NPPES: closures, moves, new sites) | Daily or weekly deltas, monthly full reconciliation |
| Practitioner registries (RPPS, NPPES) | Weekly |
| Matching and survivorship | Nightly |
| Manual review queue | Owned by RevOps, weekly, one-week SLA |

### Measuring that it is clean, and stopping it degrading

**Data-quality KPIs, per market** (one dashboard, weekly): % of sites with a validated company number, duplicate pairs open, review queue size and age, hierarchy violations, % of contacts on the right account, % of customers whose billing ID matches Hyperline, accounts owned outside their market.

**Gates that prevent new mess:**
- `company_number` unique per `country` + type in Attio, validated on entry, required from Prospect stage.
- Every automation (enrichment, n8n, email sync) **upserts on the identity**; none creates an account without a lookup. Email sync attaches contacts, it does not create companies.
- Country required; ownership routed by market.
- Warehouse tests fail the nightly run on cycles, impossible parents, or a booking URL from a platform absent in the account's country.

### Automated vs manual

| Automated | Manual |
|---|---|
| Normalisation, validation of company numbers, registry lookups, country inference | Merges involving a customer, two owners or two postcodes |
| Merges on the same validated number in the same postcode (non-customers, one owner) | Re-typing a practice into a group; creating a group from a shared domain |
| Hierarchy from a shared legal entity where unambiguous | Disputed group ownership |
| Contact re-attachment when the email domain is unique (a site whose contacts use its network's domain is attached to the network instead) | Reassigning accounts to the right market's team |
| Excluding investors, partners and media from TAM views | Overwriting a field a salesperson filled by hand |

## 5. Recommendations

Four phases, in this order: **map the current architecture, decide and design the target, build it, measure it.** Cleaning without a target architecture only treats symptoms; the tools would recreate the same mess.

| Phase | When | What | Deliverable | Depends on |
|---|---|---|---|---|
| **1 · Map the current state** | Weeks 1-2 | Every tool connected to Attio (enrichment, n8n, email sync, telephony): what it creates, what it writes, which flows run between them, who owns each one | The flow map: who creates what | Tool owners (interviews) |
| **2 · Decide and design** | Weeks 2-3 | Target architecture: account types and TAM / SAM / outside the market; generic identity; source of truth per field; one creation rule per tool; what lives in the warehouse and what lives in Attio | The target schema, signed off by Sales, data and tool owners | Sales, data team |
| **3 · Build** | Weeks 3-8, then month 3 | Generic identity in Attio, unique and validated; workflows switched to upsert; queues cleared with Sales (239 pairs, 113 hierarchy errors, 450 contacts without account, 47 US reassignments); NPI of the 175 US accounts from NPPES; TAM map v1 from the registries, US first; then the master record in the warehouse with the data team | TAM map v1 in week 5; master record in month 3 | Tool owners, Sales time, data team |
| **4 · Measure** | From week 2, ongoing | Data-quality KPIs per market: % validated identity, open duplicates, contacts without account, accounts created per tool; weekly review | We know whether the base degrades, and why | RevOps, 2 hours a week |

**In parallel, week 1:** fix what distorts the numbers today (91 automatic merges, 65 account types, 118 countries, investors, partners and media out of TAM and SAM views, 3 cycles) and switch off company creation by email sync and telephony. These need no design decision and take 2-3 days.

**Architecture first, tools second.** The warehouse then industrialises what was designed and proven by hand.

## 6. With a week and a warehouse

- Join the file to SIRENE, RPPS and NPPES for real: validate every company number, recover the SIRETs hidden behind a SIREN and the US NPIs, and size the true addressable universe per market.
- Replace the hand-tuned rules with a scored matcher (weighted keys, thresholds set on a labelled sample from the review queue) and measure precision and recall.
- Turn the script into warehouse models with tests, so the cleaning runs every night instead of once.
