# Part 1B · Mapping the TAM

> **Three choices.**
> 1. **One account model for every market.** The account is the **site**: the place patients book, the unit Vocca deploys and bills. Sites roll up to a **group** (where the decision and the framework contract sit) and a **network**. The **legal entity** is linked to sites, not used as the hierarchy.
> 2. **One generic identity in the CRM.** Attio carries `country` + `company_number` + `company_number_type` (SIRET in France, NPI in the US…), validated per type, and that is the only dedupe key. Market-specific columns and sources live upstream, in the warehouse, which joins them into this shape.
> 3. **Nothing that touches a customer or two sales owners is merged by a machine.**
>
> Real work on the file: [`scripts/tam_dedup.py`](../scripts/tam_dedup.py) applies this model to the 5,080 accounts and produces the action lists in [`out/tam/`](../out/tam/). The [TAM cockpit](https://vocca-revops-case.vercel.app/tam.html) shows the result, the rules and the manual review queue.

---

## 1. What is wrong today

Full list with every number: [`docs/data_findings.md`](data_findings.md). The issues that matter most for a market map:

| Problem | Size | Why it matters |
|---|---|---|
| No usable identity | **25% of accounts** have no validated company number: in France 756 SIRENs typed in the SIRET field and 220 empty; in the US **167 of 175** accounts have no number at all | Matching falls back on names and phones, which is where duplicates come from |
| No field for a foreign identity | The 8 US accounts that have a number carry it in the French `siret` field, typed by hand (7 by one French AE); none passes the NPI check (10 digits, starting with 1 or 2, check digit), and the anonymised export probably scrambled them | The CRM was built for France only: there is nowhere to store a US identity, so US accounts cannot be deduplicated |
| Duplicates | **117 records** are certain duplicates; 136 more pairs need a human | Two owners working the same practice; inflated TAM and pipeline |
| Duplicates are produced by tools, not people | Of the 117, **43 were created by the enrichment pipeline**, 11 by n8n, 11 by email sync; of the 450 contacts without an account, 432 were created by telephony, email sync or enrichment | The tools are connected but not orchestrated: they insert instead of upserting, so cleaning once will not last |
| No clear structure | **65 accounts without type**; 53 "practices" with several sites; 14 accounts attached to a practice (9 practices, 5 groups); 3 self-parents; **60 multi-site organisations with no group** (e.g. 3 US sites in 3 cities sharing one domain). Groups under a group are fine (sub-groups of a larger one). Open questions rather than errors: 112 empty groups, 76 single-site groups | To deploy a group tomorrow, nobody can tell from the CRM which structure to set up |
| Market not set | 118 accounts without country (all French postcodes); 67% of US accounts without lifecycle. 47 US accounts are still owned by the French team, which is expected (the first US AE started in July 2026): they go to the reassignment queue | Territories and US pipeline cannot be read by market |
| No shared definition of what counts | **101 investors, partners and media** in the same object as prospects (41 in the US), 65 accounts without type; nothing separates the TAM, the SAM and accounts outside the market | They inflate the TAM and the lead counts, and two people asked "how big is our market" get two answers |
| Junk enrichment | Practice "websites" such as doctolib.fr or gmail.com (60); **doctolib.fr booking pages on US accounts** (8), a platform that does not operate there | Enrichment writes whatever it finds, unchecked |
| Contacts on the wrong account | **244 contacts** whose work-email domain belongs to another account family; 450 without company | Outreach and champions mapped to the wrong practice |

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
| Fallback keys, same everywhere | Booking-calendar URL, normalised address, phone, website domain, name + postcode | | |

A number only counts as identity once it passes its type's validation; until then it is stored but ignored by matching. That single rule is what would have kept the US numbers out of the dedupe.

### What I refuse to merge automatically, and why

| Case | Decision | Why |
|---|---|---|
| Two different validated company numbers | Never merge; link both sites to their legal entity | Two sites of one company are two deployments |
| A site and a group sharing an identifier | Never merge; attach the site to the group | Head-office site or a missing hierarchy link |
| Either record is a customer | Manual review | Merging moves invoices and ARR |
| Open deals owned by two different people | Manual review | Ownership decision, not a data one |
| Shared phone, domain or name only | Never merge | Groups share switchboards and domains; names repeat. A domain shared across cities is a **group to create**, not a duplicate |
| Same calendar URL only, or same name + postcode without a number | Manual review | Strong hint, not proof |

**Survivor rule**: customer first, then most deals, most contacts, most complete, oldest.

## 3. Real work on the file

`python scripts/tam_dedup.py data out/tam web/data` (runs in a few seconds):

| Output | Result |
|---|---|
| `merge_clusters.csv` | **5,080 → 4,963 accounts**: 117 records merged into 115 survivors, no customer touched |
| `merge_pairs.csv` | Every candidate pair with the keys it shares, the decision and the reason: 119 auto-merge, **136 manual review** (70 involve a customer, 40 same name + postcode without number, 22 missing type, 4 same calendar only), 40 hierarchy fixes, 5,233 refused (mostly sites sharing a legal entity) |
| `hierarchy_issues.csv` | Each issue with a severity and a proposed action. Errors: 65 accounts without type, 53 practices that are groups, 17 impossible parents (14 under a practice), 3 self-parents. Questions to settle with Sales: 112 empty groups, 76 single-site groups |
| `market_issues.csv` | 356 market issues: 118 countries inferred, 101 out-of-TAM accounts, 60 multi-site organisations without group, 47 accounts owned by the other market's team, 16 unverified foreign numbers, 12 booking URLs from the wrong country |
| `contact_moves.csv` | **247 contacts** to re-attach |
| `tam_action_pack.xlsx` | All of the above in one workbook, plus the rules |

Two examples the rules get right: "Scanner IRM du Cours" exists twice with the same legal entity, name and postcode (merged); "Cabinet de Masso-Kinésithérapie Bordeaux - site 2" shares a calendar with "Cabinet de Masso-Kinésithérapie Bordeaux" (sent to review: it may be a real second site).

## 4. The build

### Why a warehouse, in one paragraph

Each market brings its own registries, booking platforms, enrichment vendors and identifier formats, plus Attio and Hyperline. Joining them, keeping history and testing matching rules is a data-engineering job: it belongs in the warehouse (being built), where source-specific columns (`siret`, `npi`, `rpps`…) are mapped into the generic model above. Attio receives the result. I would not detail the pipelines here: the point is that the CRM only ever sees one model.

### Sources, by market

| Market | Sites and legal entities | Practitioners | Booking / practice data |
|---|---|---|---|
| France | SIRENE (INSEE), FINESS for health centres and clinics | Annuaire Santé / RPPS | Doctolib, Maiia public pages (to clear with legal before systematic collection) |
| United States | NPPES (NPI registry, organisations), CMS provider data linking clinicians to group practices | NPPES (individual NPI), state licensing boards | Practice websites; paid healthcare data vendors for group and DSO structures |
| Every market | Enrichment vendors write to **contacts** only and never create accounts | | |

The TAM is built from the registries, not from the CRM: every site of a target specialty and structure type, scored, then flagged "in Attio / not in Attio".

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
| Normalisation, validation of company numbers, registry lookups, country inference | Merges involving a customer or two owners |
| Merges on the same validated number (non-customers) | Re-typing a practice into a group; creating a group from a shared domain |
| Hierarchy from a shared legal entity where unambiguous | Disputed group ownership |
| Contact re-attachment when the email domain is unique | Reassigning accounts to the right market's team |
| Excluding investors, partners and media from TAM views | Overwriting a field a salesperson filled by hand |

## 5. Recommendations

| Priority | What | Why first | Effort |
|---|---|---|---|
| **P0 · Stop the bleeding** | Generic identity in Attio (`country`, `company_number`, type), unique and validated; automations switched to upsert; creation lookup | Otherwise every clean-up is undone within weeks | Week 1 |
| **P0 · Fix what breaks reporting** | 117 automatic merges; account and relationship types set; countries set; investors, partners and media out of TAM and SAM views; the 3 cycles and 17 impossible parents | Revenue, pipeline and TAM numbers are wrong today | Weeks 1-2 |
| **P1 · Master record** | Warehouse models joining Attio, Hyperline and the French and US registries into the generic model; sync to Attio | One source of truth, refreshed, with history | Weeks 2-5 |
| **P1 · Clear the queues** | 136 review pairs, 38 sites to attach, 60 groups to create, 47 accounts to reassign to the US team, 247 contacts | Small enough to finish in a few days with Sales | Weeks 2-3, about 3 days of work |
| **P1 · US identity** | Find the NPI of the 175 US accounts in NPPES (167 have no number today); build their groups (dental groups first) | The US base is small: fixing it now is cheap, after 1,000 accounts it is not | Weeks 3-4 |
| **P2 · Size and score the TAM per market** | Full universe from registries by specialty and structure type; score; flag "not in Attio" | Feeds territories and outbound for the 3x plan, starting with the US | Weeks 5-7 |
| **P3 · Run it** | Data-quality dashboard per market, weekly review, warehouse tests | Keeps it clean without heroics | Ongoing |

**Rough plan: 6 to 8 weeks for one person**, with visible value in the first two weeks.

## 6. With a week and a warehouse

- Join the file to SIRENE, RPPS and NPPES for real: validate every company number, recover the SIRETs hidden behind a SIREN and the US NPIs, and size the true addressable universe per market.
- Replace the hand-tuned rules with a scored matcher (weighted keys, thresholds set on a labelled sample from the review queue) and measure precision and recall.
- Turn the script into warehouse models with tests, so the cleaning runs every night instead of once.
