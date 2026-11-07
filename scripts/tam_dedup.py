"""Account deduplication, hierarchy audit and contact re-attachment for the TAM.

Account model (Part 1B): the account is the SITE (one SIRET, one booking calendar),
rolled up to a GROUP (where the decision and the framework contract sit) and a
NETWORK (Superorga). The legal entity (SIREN) is a separate attribute linked to sites:
several sites can share a SIREN, and a group can own sites with different SIRENs.

Matching keys, strongest first: valid SIRET, booking-calendar URL, normalised phone,
website domain (platforms and webmail excluded), normalised name + postcode.

Never merged automatically:
  - different valid SIRETs (two sites, even under the same SIREN);
  - a Practice and a Group/Superorga (that is a hierarchy fix, not a duplicate);
  - pairs where either record is a customer (billing ID or signed ARR);
  - pairs with open deals owned by different people;
  - matches resting on a shared phone, domain or name only.

Usage: python scripts/tam_dedup.py <data_dir> <out_dir> [<web_data_dir>]
Writes merge_pairs.csv, merge_clusters.csv, hierarchy_issues.csv, contact_moves.csv
and summary.json to <out_dir>. With <web_data_dir>, also writes the TAM cockpit feed
(tam_cockpit.json) and the action pack (tam_action_pack.xlsx) there.
"""
import json
import re
import sys
import unicodedata
from pathlib import Path

import pandas as pd

PLATFORM_OR_WEBMAIL_DOMAINS = {
    "doctolib.fr", "maiia.com", "pagesjaunes.fr", "keldoc.com", "mondocteur.fr",
    "gmail.com", "hotmail.fr", "hotmail.com", "yahoo.fr", "yahoo.com", "orange.fr",
    "wanadoo.fr", "free.fr", "outlook.fr", "outlook.com", "laposte.net", "sfr.fr",
    "icloud.com", "live.fr", "aol.com", "neuf.fr",
}
LEGAL_FORM_WORDS = {
    "selarl", "selas", "sas", "sarl", "sa", "scm", "sci", "scp", "sisa", "gie", "sel",
    "eurl", "association", "asso", "fondation", "mutuelle", "groupe", "cabinet", "centre",
    "de", "du", "des", "la", "le", "les", "d", "l", "et", "the", "of",
}
CUSTOMER_LIFECYCLES = {"Customer", "Churn"}
LIFECYCLE_RANK = {"Customer": 0, "Churn": 1, "Prospect": 2, "Lead": 3}


# ---------- normalisation ----------
def strip_accents(text):
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()


def norm_name(name):
    if pd.isna(name):
        return None
    words = re.findall(r"[a-z0-9]+", strip_accents(str(name)).lower())
    kept = [w for w in words if w not in LEGAL_FORM_WORDS]
    return " ".join(kept) or None


def norm_siret(value):
    if pd.isna(value):
        return None, "missing"
    digits = re.sub(r"\D", "", str(value))
    if len(digits) == 14:
        return digits, "siret"
    if len(digits) == 9:
        return digits, "siren_only"
    return None, "invalid"


def luhn_ok(digits):
    total = 0
    for i, ch in enumerate(reversed(digits)):
        n = int(ch)
        if i % 2 == 1:
            n = n * 2 - 9 if n * 2 > 9 else n * 2
        total += n
    return total % 10 == 0


def norm_phone(value):
    if pd.isna(value):
        return None
    digits = re.sub(r"\D", "", str(value))
    if digits.startswith("33") and len(digits) == 11:
        digits = "0" + digits[2:]
    return digits if len(digits) >= 9 else None


def norm_domains(value):
    if pd.isna(value):
        return []
    out = []
    for raw in str(value).split(","):
        d = raw.strip().lower()
        d = re.sub(r"^https?://", "", d).split("/")[0]
        d = re.sub(r"^www\.", "", d)
        if d and d not in PLATFORM_OR_WEBMAIL_DOMAINS:
            out.append(d)
    return out


def norm_calendar(value):
    if pd.isna(value):
        return None
    url = str(value).strip().lower().split("?")[0].split("#")[0].rstrip("/")
    return re.sub(r"^https?://(www\.)?", "", url) or None


# ---------- loading ----------
def load(data_dir):
    companies = pd.read_csv(f"{data_dir}/companies.csv", dtype=str)
    deals = pd.read_csv(f"{data_dir}/deals.csv", dtype=str)
    contacts = pd.read_csv(f"{data_dir}/contacts.csv", dtype=str)

    c = companies.copy()
    parsed = c.siret.map(norm_siret)
    c["siret_norm"] = parsed.map(lambda x: x[0])
    c["siret_status"] = parsed.map(lambda x: x[1])
    c["siret_valid"] = c.siret_status.eq("siret")
    c["siren"] = c.siret_norm.str[:9]
    c["name_norm"] = c.name.map(norm_name)
    c["phone_norm"] = c.standard_phone.map(norm_phone)
    c["domain_list"] = c.domains.map(norm_domains)
    c["calendar_norm"] = c.calendar_url.map(norm_calendar)
    c["is_customer"] = (
        c.lifecycle.isin(CUSTOMER_LIFECYCLES)
        | c.hyperline_customer_id.notna()
        | pd.to_numeric(c.arr_signed_eur, errors="coerce").gt(0)
    )
    open_deals = deals[~deals.stage.isin(["Closed Won", "Closed Lost"])]
    owners = open_deals.groupby("company_record_id").owner.apply(lambda s: frozenset(s.dropna()))
    c["open_deal_owners"] = c.record_id.map(owners).map(lambda v: v if isinstance(v, frozenset) else frozenset())
    c["deal_count"] = c.record_id.map(deals.company_record_id.value_counts()).fillna(0).astype(int)
    c["contact_count"] = c.record_id.map(contacts.company_record_id.value_counts()).fillna(0).astype(int)
    c["filled_fields"] = companies.notna().sum(axis=1)
    return c, deals, contacts


# ---------- candidate pairs ----------
def candidate_pairs(c):
    """Block on each key and collect, per pair, the keys they share."""
    evidence = {}

    def add_block(series, key_name):
        groups = series.dropna().groupby(series.dropna()).groups
        for _, idx in groups.items():
            ids = sorted(set(c.loc[idx, "record_id"]))
            if len(ids) < 2 or len(ids) > 25:  # a key shared by >25 rows is a generic value, not an identity
                continue
            for i in range(len(ids)):
                for j in range(i + 1, len(ids)):
                    evidence.setdefault((ids[i], ids[j]), set()).add(key_name)

    add_block(c.siret_norm.where(c.siret_valid), "siret")
    add_block(c.siren.where(c.siret_status.isin(["siret", "siren_only"])), "siren")
    add_block(c.calendar_norm, "calendar")
    add_block(c.phone_norm, "phone")
    domains = c[["record_id", "domain_list"]].explode("domain_list").dropna()
    add_block(domains.set_index(domains.index).domain_list, "domain")
    name_pc = (c.name_norm + "|" + c.postcode.fillna("")).where(c.name_norm.notna() & c.postcode.notna())
    add_block(name_pc, "name_postcode")
    return evidence


def decide(a, b, keys):
    """Return (decision, reason). Decisions: auto_merge, manual_review, do_not_merge, hierarchy_fix.

    Evidence first, guards second: the customer and owner guards only downgrade a
    pair that would otherwise be merged.
    """
    type_a, type_b = a["type"], b["type"]
    weak = f"weak evidence only ({', '.join(sorted(keys))}): typically a shared group phone/domain or a recycled number"
    if a["siret_valid"] and b["siret_valid"] and a["siret_norm"] != b["siret_norm"]:
        if a["siren"] == b["siren"]:
            return "do_not_merge", "same legal entity (SIREN), different sites (SIRET): link to one legal entity, keep both sites"
        return "do_not_merge", "different valid SIRETs: two distinct sites"
    if not isinstance(type_a, str) or not isinstance(type_b, str):
        return "manual_review", "account type missing on one record"
    identity = keys & {"siret", "siren", "calendar", "domain"}
    if type_a != type_b:
        if not identity:
            return "do_not_merge", weak
        if a["record_id"] == b.get("parent_record_id") or b["record_id"] == a.get("parent_record_id"):
            return "already_linked", "site already attached to this group: correct, nothing to do"
        site = a if type_a == "Practice" else b
        if isinstance(site.get("parent_record_id"), str):
            return "hierarchy_fix", f"site shares {'+'.join(sorted(identity))} with another group than its current parent: check which group owns it"
        return "hierarchy_fix", f"orphan site shares {'+'.join(sorted(identity))} with a {type_b if site is a else type_a}: attach it, do not merge"

    if "siret" in keys:
        decision, reason = "auto_merge", "same valid SIRET, same type"
    elif "calendar" in keys and keys & {"phone", "name_postcode", "domain", "siren"}:
        decision, reason = "auto_merge", "same booking calendar confirmed by a second key"
    elif "siren" in keys and "name_postcode" in keys:
        decision, reason = "auto_merge", "same SIREN, same name and postcode"
    elif "calendar" in keys:
        decision, reason = "manual_review", "same booking calendar only"
    elif "name_postcode" in keys:
        decision, reason = "manual_review", "same name and postcode, no SIRET to confirm or contradict"
    else:
        return "do_not_merge", weak

    if a["is_customer"] or b["is_customer"]:
        return "manual_review", "customer record involved (billing ID / ARR): never merged automatically"
    if len(a["open_deal_owners"] | b["open_deal_owners"]) > 1:
        return "manual_review", "open deals owned by different people: needs an owner decision"
    return decision, reason


# ---------- clustering and survivor ----------
def clusters_from(pairs, c):
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        parent[find(a)] = find(b)
    groups = {}
    for x in list(parent):
        groups.setdefault(find(x), []).append(x)
    rows = []
    by_id = c.set_index("record_id")
    for n, members in enumerate(sorted(groups.values(), key=len, reverse=True), start=1):
        m = by_id.loc[members]
        ranked = m.assign(
            lc=m.lifecycle.map(LIFECYCLE_RANK).fillna(9),
            neg_deals=-m.deal_count,
            neg_contacts=-m.contact_count,
            neg_filled=-m.filled_fields,
        ).sort_values(["lc", "neg_deals", "neg_contacts", "neg_filled", "created_at"])
        survivor = ranked.index[0]
        for rid in members:
            rows.append({
                "cluster_id": f"C{n:04d}",
                "record_id": rid,
                "role": "survivor" if rid == survivor else "merge_into_survivor",
                "survivor_id": survivor,
                "name": by_id.at[rid, "name"],
                "type": by_id.at[rid, "type"],
                "lifecycle": by_id.at[rid, "lifecycle"],
                "siret": by_id.at[rid, "siret_norm"],
                "postcode": by_id.at[rid, "postcode"],
                "deals": by_id.at[rid, "deal_count"],
                "contacts": by_id.at[rid, "contact_count"],
            })
    return pd.DataFrame(rows)


# ---------- hierarchy ----------
def hierarchy_issues(c):
    by_id = c.set_index("record_id")
    rows = []

    def issue(rid, kind, detail, action):
        rows.append({"record_id": rid, "name": by_id.at[rid, "name"], "type": by_id.at[rid, "type"],
                     "issue": kind, "detail": detail, "proposed_action": action})

    children = c.parent_record_id.value_counts()
    for rid, row in by_id.iterrows():
        parent_id = row.parent_record_id
        if pd.isna(row.type):
            issue(rid, "missing_type", "type is empty", "derive from practice_count / children / SIRET")
        if isinstance(parent_id, str):
            if parent_id == rid:
                issue(rid, "self_parent", "record is its own parent", "clear parent_record_id")
                continue
            if parent_id not in by_id.index:
                issue(rid, "orphan_parent", "parent not found", "clear or re-match parent")
                continue
            ptype = by_id.at[parent_id, "type"]
            allowed = {"Practice": {"Group", "Superorga"}, "Group": {"Superorga"}, "Superorga": set()}
            if isinstance(row.type, str) and ptype not in allowed.get(row.type, set()):
                issue(rid, "invalid_parent_type", f"{row.type} under {ptype}", "re-type the parent or re-attach to the right group")
            if pd.notna(row.arr_signed_eur) and pd.notna(by_id.at[parent_id, "arr_signed_eur"]):
                issue(rid, "arr_on_parent_and_child", "ARR carried at both levels", "keep ARR on sites only; group ARR = sum of sites")
        pc = pd.to_numeric(row.practice_count, errors="coerce")
        if row.type == "Practice" and pc and pc > 1:
            issue(rid, "practice_looks_like_group", f"practice_count = {int(pc)}", "re-type as Group and create its sites")
        if row.type == "Group":
            n = int(children.get(rid, 0))
            if n == 0:
                issue(rid, "empty_group", "no child site in the CRM", "create sites from SIRENE (same SIREN) or re-type as Practice")
            elif n == 1:
                issue(rid, "single_site_group", "one child site only", "check: real group or duplicate of its site")
    return pd.DataFrame(rows)


# ---------- contacts on the wrong account ----------
def contact_moves(c, contacts, merge_map):
    parents = dict(zip(c.record_id, c.parent_record_id))

    def root(rid):
        seen = set()
        while isinstance(parents.get(rid), str) and rid not in seen:
            seen.add(rid)
            rid = parents[rid]
        return rid

    domain_owner = {}
    for _, row in c[["record_id", "domain_list"]].iterrows():
        for d in row.domain_list:
            domain_owner.setdefault(d, set()).add(row.record_id)
    unique_domain = {d: next(iter(ids)) for d, ids in domain_owner.items() if len(ids) == 1}

    rows = []
    for _, p in contacts.dropna(subset=["email_addresses"]).iterrows():
        email = str(p.email_addresses).split(",")[0].strip().lower()
        dom = email.split("@")[-1]
        target = unique_domain.get(dom)
        current = p.company_record_id
        if not target or target == current:
            continue
        if isinstance(current, str) and root(current) == root(target):
            continue  # same account family (site vs its group): not a wrong attachment
        rows.append({
            "contact_id": p.record_id,
            "email_domain": dom,
            "current_company_id": current if isinstance(current, str) else "",
            "proposed_company_id": merge_map.get(target, target),
            "reason": "no company attached" if not isinstance(current, str) else "email domain belongs to another account family",
        })
    return pd.DataFrame(rows)


# ---------- cockpit export (web page + action pack) ----------
MATCH_KEYS = [
    {"key": "siret", "label": "SIRET (14 digits, checksum, active)", "role": "Identity of a site. Same SIRET + same type = automatic merge"},
    {"key": "calendar", "label": "Booking-calendar URL", "role": "One calendar per site. Automatic merge only if a second key agrees"},
    {"key": "siren", "label": "SIREN (legal entity)", "role": "Links sites to one legal entity. Merges only with same name + postcode"},
    {"key": "name_postcode", "label": "Normalised name + postcode", "role": "Strong hint: manual review, never automatic alone"},
    {"key": "phone", "label": "Normalised phone", "role": "Supporting evidence only: switchboards are shared"},
    {"key": "domain", "label": "Website domain (platforms and webmail excluded)", "role": "Supporting evidence only: group domains are shared"},
]
GUARDS = [
    {"rule": "Different valid SIRETs are never merged", "why": "Two sites, even under one SIREN, are two deployments", "match": "different valid SIRET|different sites \\(SIRET\\)"},
    {"rule": "A site and a group are never merged", "why": "It is a missing hierarchy link or the group's head-office site", "match": "site shares|orphan site"},
    {"rule": "Customers are never merged automatically", "why": "A merge moves invoices and ARR: a human signs it off", "match": "customer record involved"},
    {"rule": "Two owners with open deals: manual", "why": "Ownership is a sales decision, not a data one", "match": "open deals owned by different"},
    {"rule": "Shared phone, domain or name alone: no merge", "why": "Groups share switchboards and domains; names repeat", "match": "weak evidence only"},
    {"rule": "Missing account type: manual", "why": "The model cannot place the record", "match": "account type missing"},
]
HIERARCHY_ACTIONS = {
    "self_parent": ("auto", "Clear the parent link"),
    "arr_on_parent_and_child": ("auto", "Keep ARR on sites, group ARR becomes the sum"),
    "invalid_parent_type": ("manual", "Re-type or re-attach"),
    "practice_looks_like_group": ("manual", "Re-type as group and create its sites"),
    "empty_group": ("manual", "Create sites from SIRENE or re-type as practice"),
    "single_site_group": ("manual", "Check: real group or duplicate of its site"),
    "missing_type": ("manual", "Set the type"),
    "orphan_parent": ("auto", "Clear the parent link"),
}


def current_state(c, contacts):
    arr = pd.to_numeric(c.arr_signed_eur, errors="coerce")
    parent_arr = c.parent_record_id.map(dict(zip(c.record_id, arr)))
    junk_domain = c.domains.fillna("").str.lower().str.contains("|".join(re.escape(d) for d in PLATFORM_OR_WEBMAIL_DOMAINS))
    types = c.set_index("record_id").type
    return {
        "accounts": int(len(c)),
        "by_type": {str(k): int(v) for k, v in c.type.fillna("Missing").value_counts().items()},
        "by_lifecycle": {str(k): int(v) for k, v in c.lifecycle.fillna("Missing").value_counts().items()},
        "siret_status": {k: int(v) for k, v in c.siret_status.value_counts().items()},
        "siret_checksum_failures": int((~c[c.siret_valid].siret_norm.map(luhn_ok)).sum()),
        "multi_site_sirens": int(c[c.siret_valid].groupby("siren").siret_norm.nunique().gt(1).sum()),
        "calendar_coverage": int(c.calendar_norm.notna().sum()),
        "junk_domains": int(junk_domain.sum()),
        "arr_double_counted_sites": int((arr.notna() & parent_arr.notna()).sum()),
        "arr_double_counted_eur": float(arr[arr.notna() & parent_arr.notna()].sum()),
        "customer_arr_eur": float(arr[c.lifecycle.eq("Customer")].sum()),
        "billing_id_on_non_customers": int((c.hyperline_customer_id.notna() & c.lifecycle.ne("Customer")).sum()),
        "customers_without_arr": int((c.lifecycle.eq("Customer") & arr.isna()).sum()),
        "contacts": int(len(contacts)),
        "contacts_without_company": int(contacts.company_record_id.isna().sum()),
        "contacts_on_group_level": int(contacts.company_record_id.map(types).isin(["Group", "Superorga"]).sum()),
    }


def duplicate_sources(clusters, c):
    merged = clusters[clusters.role.eq("merge_into_survivor")]
    return {str(k): int(v) for k, v in c.set_index("record_id").loc[merged.record_id].created_by.fillna("Unknown").value_counts().items()}


def rules_usage(pairs):
    usage_keys = []
    for k in MATCH_KEYS:
        has = pairs.shared_keys.str.split("+").map(lambda s, key=k["key"]: key in s)
        usage_keys.append({**k, "pairs": int(has.sum()), "auto_merges": int((has & pairs.decision.eq("auto_merge")).sum())})
    usage_guards = []
    for g in GUARDS:
        hit = pairs.reason.str.contains(g["match"], case=False, regex=True)
        usage_guards.append({"rule": g["rule"], "why": g["why"], "pairs_blocked_or_routed": int(hit.sum())})
    merge_reasons = pairs[pairs.decision.eq("auto_merge")].reason.value_counts()
    return {
        "keys": usage_keys,
        "guards": usage_guards,
        "auto_merge_reasons": [{"reason": r, "pairs": int(n)} for r, n in merge_reasons.items()],
        "survivor_rule": "Customer first, then most deals, most contacts, most complete, oldest",
    }


def record_card(row, deals_by_company):
    deals = deals_by_company.get(row.name, [])
    arr = pd.to_numeric(row.arr_signed_eur, errors="coerce")
    return {
        "id": row.name,
        "name": row["name"],
        "type": row.type if isinstance(row.type, str) else None,
        "lifecycle": row.lifecycle if isinstance(row.lifecycle, str) else None,
        "siret": row.siret if isinstance(row.siret, str) else None,
        "address": " ".join(str(x) for x in [row.postcode, row.city] if isinstance(x, str)),
        "phone": row.standard_phone if isinstance(row.standard_phone, str) else None,
        "domains": row.domains if isinstance(row.domains, str) else None,
        "calendar": row.calendar_url if isinstance(row.calendar_url, str) else None,
        "owner": row.sales_owner if isinstance(row.sales_owner, str) else None,
        "billing_id": isinstance(row.hyperline_customer_id, str),
        "arr": None if pd.isna(arr) else float(arr),
        "deals": len(deals),
        "open_deals": [{"stage": d["stage"], "owner": d["owner"]} for d in deals if d["stage"] not in ("Closed Won", "Closed Lost")],
        "created_by": row.created_by if isinstance(row.created_by, str) else None,
    }


def write_cockpit(web_dir, c, contacts, deals, pairs, clusters, hierarchy, moves, summary):
    web = Path(web_dir)
    web.mkdir(parents=True, exist_ok=True)
    by_id = c.set_index("record_id")
    deals_by_company = {cid: g[["stage", "owner"]].to_dict("records") for cid, g in deals.groupby("company_record_id")}

    review = pairs[pairs.decision.eq("manual_review")]
    review_items = [{
        "pair_id": f"{r.record_a}|{r.record_b}",
        "reason": r.reason,
        "shared_keys": r.shared_keys.split("+"),
        "a": record_card(by_id.loc[r.record_a], deals_by_company),
        "b": record_card(by_id.loc[r.record_b], deals_by_company),
    } for r in review.itertuples()]

    hier_counts = hierarchy.issue.value_counts()
    actions = [
        {"action": "Merge duplicates", "mode": "auto", "count": summary["records_removed_by_auto_merge"], "detail": f"{summary['auto_merge_clusters']} survivors keep deals, contacts and history", "prod": "n8n workflow tam-merge -> Attio merge API, logged"},
        {"action": "Re-attach contacts", "mode": "auto", "count": int(len(moves)), "detail": "Work-email domain owned by exactly one other account family", "prod": "n8n workflow tam-contacts -> Attio update"},
    ]
    for issue, n in hier_counts.items():
        mode, what = HIERARCHY_ACTIONS.get(issue, ("manual", "Review"))
        actions.append({"action": f"Hierarchy: {issue.replace('_', ' ')}", "mode": mode, "count": int(n), "detail": what,
                        "prod": "dbt model + Attio sync" if mode == "auto" else "RevOps review queue"})
    actions.append({"action": "Review candidate duplicates", "mode": "manual", "count": int(len(review)), "detail": "Customer involved, no SIRET to confirm, or calendar only", "prod": "Review queue in this cockpit -> decisions to Attio"})
    actions.append({"action": "Attach sites to their group", "mode": "manual", "count": summary["sites_to_attach_or_check"], "detail": "Site shares SIREN/SIRET with a group it is not attached to", "prod": "RevOps review queue"})

    cockpit = {
        "generated_from": "scripts/tam_dedup.py",
        "current": current_state(c, contacts),
        "summary": summary,
        "duplicate_sources": duplicate_sources(clusters, c),
        "rules": rules_usage(pairs),
        "actions": actions,
        "merge_examples": clusters.head(60).fillna("").to_dict("records"),
        "review": review_items,
    }
    (web / "tam_cockpit.json").write_text(json.dumps(cockpit, ensure_ascii=False, default=str))
    write_action_pack(web / "tam_action_pack.xlsx", cockpit, clusters, review, hierarchy, moves, pairs)


def write_action_pack(path, cockpit, clusters, review, hierarchy, moves, pairs):
    readme = pd.DataFrame({"Vocca TAM action pack": [
        "Produced by scripts/tam_dedup.py on the anonymised Attio export of 25 Sep 2026.",
        "Model: the account is the site (SIRET), rolled up to a group and a network; the legal entity (SIREN) is linked.",
        "Auto merges: certain duplicates, never a customer, never two owners. Survivor: customer, most deals, most contacts, most complete, oldest.",
        "Manual review: pairs the rules refuse to merge without a human. Decide in the TAM cockpit, then export.",
        "Tabs: Summary, Rules, Auto merges, Manual review, Hierarchy, Contact moves, All pairs.",
    ]})
    s = cockpit["summary"]
    summary = pd.DataFrame([
        ("Accounts before", s["accounts_before"]), ("Accounts after auto merge", s["accounts_after_auto_merge"]),
        ("Records removed by auto merge", s["records_removed_by_auto_merge"]), ("Pairs for manual review", len(review)),
        ("Sites to attach or check", s["sites_to_attach_or_check"]), ("Contacts to re-attach", len(moves)),
    ] + [(f"Hierarchy: {k}", v) for k, v in s["hierarchy_issues"].items()], columns=["Metric", "Value"])
    rules = pd.DataFrame(cockpit["rules"]["keys"])[["label", "role", "pairs", "auto_merges"]]
    guards = pd.DataFrame(cockpit["rules"]["guards"])
    with pd.ExcelWriter(path, engine="openpyxl") as xl:
        readme.to_excel(xl, sheet_name="README", index=False)
        summary.to_excel(xl, sheet_name="Summary", index=False)
        rules.to_excel(xl, sheet_name="Rules", index=False, startrow=0)
        guards.to_excel(xl, sheet_name="Rules", index=False, startrow=len(rules) + 3)
        clusters.to_excel(xl, sheet_name="Auto merges", index=False)
        review.assign(decision_by_reviewer="").to_excel(xl, sheet_name="Manual review", index=False)
        hierarchy.to_excel(xl, sheet_name="Hierarchy", index=False)
        moves.to_excel(xl, sheet_name="Contact moves", index=False)
        pairs.to_excel(xl, sheet_name="All pairs", index=False)
        for ws in xl.book.worksheets:
            ws.freeze_panes = "A2"
            for col in ws.columns:
                width = max(len(str(cell.value or "")) for cell in col[:200])
                ws.column_dimensions[col[0].column_letter].width = min(max(10, width + 2), 60)


def main(data_dir, out_dir, web_data_dir=None):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    c, deals, contacts = load(data_dir)
    by_id = c.set_index("record_id")

    evidence = candidate_pairs(c)
    pair_rows = []
    for (a_id, b_id), keys in evidence.items():
        a, b = by_id.loc[a_id].to_dict(), by_id.loc[b_id].to_dict()
        a["record_id"], b["record_id"] = a_id, b_id
        decision, reason = decide(a, b, keys)
        pair_rows.append({
            "record_a": a_id, "record_b": b_id, "name_a": a["name"], "name_b": b["name"],
            "type_a": a["type"], "type_b": b["type"], "shared_keys": "+".join(sorted(keys)),
            "decision": decision, "reason": reason,
        })
    pairs = pd.DataFrame(pair_rows)
    pairs = pairs[pairs.decision.ne("already_linked")].sort_values(["decision", "shared_keys"])
    pairs.to_csv(out / "merge_pairs.csv", index=False)

    auto = pairs[pairs.decision.eq("auto_merge")]
    clusters = clusters_from(list(zip(auto.record_a, auto.record_b)), c)
    clusters.to_csv(out / "merge_clusters.csv", index=False)
    merge_map = dict(zip(clusters.record_id, clusters.survivor_id))

    hierarchy = hierarchy_issues(c)
    hierarchy.to_csv(out / "hierarchy_issues.csv", index=False)
    moves = contact_moves(c, contacts, merge_map)
    moves.to_csv(out / "contact_moves.csv", index=False)

    removed = int(clusters.role.eq("merge_into_survivor").sum()) if len(clusters) else 0
    sirets = c[c.siret_valid].siret_norm
    summary = {
        "accounts_before": int(len(c)),
        "accounts_after_auto_merge": int(len(c) - removed),
        "records_removed_by_auto_merge": removed,
        "auto_merge_clusters": int(clusters.cluster_id.nunique()) if len(clusters) else 0,
        "pairs_by_decision": pairs.decision.value_counts().to_dict(),
        "manual_review_reasons": pairs[pairs.decision.eq("manual_review")].reason.value_counts().to_dict(),
        "hierarchy_fix_reasons": pairs[pairs.decision.eq("hierarchy_fix")].reason.str.split(":").str[0].value_counts().to_dict(),
        "sites_to_attach_or_check": int(pd.concat([
            pairs[pairs.decision.eq("hierarchy_fix") & pairs.type_a.eq("Practice")].record_a,
            pairs[pairs.decision.eq("hierarchy_fix") & pairs.type_b.eq("Practice")].record_b,
        ]).nunique()),
        "siret_status": c.siret_status.value_counts().to_dict(),
        "valid_siret_failing_checksum": int((~sirets.map(luhn_ok)).sum()),
        "multi_site_sirens": int(c[c.siret_valid].groupby("siren").siret_norm.nunique().gt(1).sum()),
        "hierarchy_issues": hierarchy.issue.value_counts().to_dict() if len(hierarchy) else {},
        "contact_moves": moves.reason.value_counts().to_dict() if len(moves) else {},
    }
    (out / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False))
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    if web_data_dir:
        write_cockpit(web_data_dir, c, contacts, deals, pairs, clusters, hierarchy, moves, summary)
        print(f"cockpit feed and action pack -> {web_data_dir}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
