"""Data-quality checks on companies and contacts: identity keys, duplicates, hierarchy, fields, wrong-account contacts.

Usage: python scripts/checks_accounts.py <data_dir>
"""
import sys, re, unicodedata, pandas as pd
d=sys.argv[1]
D=pd.read_csv(f"{d}/deals.csv",dtype=str); C=pd.read_csv(f"{d}/companies.csv",dtype=str); P=pd.read_csv(f"{d}/contacts.csv",dtype=str); T=pd.read_csv(f"{d}/sales_team.csv",dtype=str)
def p(k,v): print(f"{k:70s} {v}")
def norm(s):
    if pd.isna(s): return None
    s=unicodedata.normalize("NFKD",str(s)).encode("ascii","ignore").decode().lower()
    return re.sub(r"[^a-z0-9]","",s) or None
print("=== COMPANIES")
sir=C.siret.dropna()
print("siret length dist:", sir.str.len().value_counts().to_dict())
p("siret non-digit", (~sir.str.fullmatch(r"\d+")).sum())
C["siren"]=C.siret.where(C.siret.str.len().isin([9,14])).str[:9]
dsir=C[C.siret.notna()].siret.duplicated(keep=False); p("rows sharing an identical SIRET", f"{dsir.sum()} rows / {C[C.siret.notna()][dsir].siret.nunique()} sirets")
g=C[C.siret.notna()&dsir].groupby("siret")
print("  same-SIRET pairs: same type?", g.type.nunique().eq(1).sum(), "| same name?", g.name.apply(lambda s:s.map(norm).nunique()==1).sum(), "| one is parent of other?",
      g.apply(lambda x: x.parent_record_id.isin(x.record_id).any()).sum())
p("SIREN shared by >1 row", f"{C.siren.dropna().duplicated(keep=False).sum()} rows")
C["nname"]=C.name.map(norm)
k=C.nname+"|"+C.postcode.fillna("")
p("dup name+postcode", f"{k.duplicated(keep=False).sum()} rows / {k[k.duplicated(keep=False)].nunique()} keys")
p("dup normalized name (any place)", f"{C.nname.duplicated(keep=False).sum()} rows")
dom=C.domains.dropna().str.split(r",\s*").explode().str.lower().str.replace(r"^www\.","",regex=True)
dd=dom[dom.duplicated(keep=False)]; p("rows sharing a domain", f"{dd.index.nunique()} rows / {dd.nunique()} domains")
print("  top shared domains:", dom.value_counts().head(8).to_dict())
ph=C.standard_phone.dropna().str.replace(r"\D","",regex=True)
p("rows sharing a switchboard phone", ph.duplicated(keep=False).sum())
print("  phone formats:", C.standard_phone.dropna().str.replace(r"\d","9",regex=True).value_counts().head(5).to_dict())
p("calendar_url shared", C.calendar_url.dropna().duplicated(keep=False).sum())
li=C.linkedin_url.dropna(); p("linkedin shared", li.duplicated(keep=False).sum())
print("--- hierarchy")
ids=set(C.record_id); par=C.parent_record_id.dropna()
p("parent_record_id not found", (~par.isin(ids)).sum())
p("self-parent", (C.parent_record_id==C.record_id).sum())
PT=C.merge(C[["record_id","type"]].rename(columns={"record_id":"parent_record_id","type":"ptype"}),on="parent_record_id",how="left")
print(pd.crosstab(PT.type.fillna("NA"),PT.ptype.fillna("(none)")).to_string())
kids=C.parent_record_id.value_counts()
grp=C[C.type=="Group"]; p("Groups with 0 child practices", (~grp.record_id.isin(kids.index)).sum()); p("Groups with exactly 1 child", grp.record_id.map(kids).eq(1).sum())
pc=pd.to_numeric(grp.practice_count,errors="coerce"); real=grp.record_id.map(kids).fillna(0)
p("Groups with practice_count filled", pc.notna().sum()); p("  practice_count != children in CRM", (pc.notna() & (pc!=real)).sum())
pr=C[C.type=="Practice"]; p("Practice with practice_count>1", (pd.to_numeric(pr.practice_count,errors="coerce")>1).sum())
# cycles
pm=dict(zip(C.record_id,C.parent_record_id)); cyc=0
for r in C.record_id:
    seen=set(); x=r
    while isinstance(x,str) and x in pm:
        if x in seen: cyc+=1; break
        seen.add(x); x=pm[x]
p("records in a parent cycle", cyc)
# child/parent area/country mismatch
PC=C.merge(C[["record_id","country","sales_owner","lifecycle"]].rename(columns={"record_id":"parent_record_id","country":"pc","sales_owner":"pso","lifecycle":"pl"}),on="parent_record_id")
p("child sales_owner != parent sales_owner", (PC.sales_owner.notna()&PC.pso.notna()&(PC.sales_owner!=PC.pso)).sum())
p("child Customer, parent Lead", ((PC.lifecycle=="Customer")&(PC.pl=="Lead")).sum())
print("--- fields")
print("country:", C.country.value_counts(dropna=False).to_dict())
p("US/non-FR rows with FR-style area", (C.country.ne("FR")&C.country.ne("France")&C.area.isin(["Paris Area","South West","North West","Central","South East","North East"])).sum())
print("area:", C.area.value_counts(dropna=False).to_dict())
pc5=C.postcode.dropna(); p("FR postcode not 5 digits", ((C.country=="FR")&C.postcode.notna()&~C.postcode.fillna("").str.fullmatch(r"\d{5}")).sum())
p("city all caps / mixed (case variants of same city)", C.city.dropna().str.lower().nunique() - C.city.dropna().nunique())
p("postcode in address_line != postcode col", (C.address_line.notna()&C.postcode.notna()&~C.apply(lambda r: str(r.postcode) in str(r.address_line),axis=1)).sum())
sp=C.specialty.dropna().str.split(r",\s*").explode(); print("specialty distinct tokens:", sp.nunique(), sp.value_counts().head(25).to_dict())
p("lifecycle empty", C.lifecycle.isna().sum())
p("Customer without arr_signed_eur", ((C.lifecycle=="Customer")&C.arr_signed_eur.isna()).sum())
p("Customer without hyperline id", ((C.lifecycle=="Customer")&C.hyperline_customer_id.isna()).sum())
p("non-Customer with hyperline id", ((C.lifecycle!="Customer")&C.hyperline_customer_id.notna()).sum())
print("   ...by lifecycle:", C[C.hyperline_customer_id.notna()].lifecycle.value_counts(dropna=False).to_dict())
p("hyperline id shared by >1 company", C.hyperline_customer_id.dropna().duplicated(keep=False).sum())
p("customer_lifecycle set but not Customer", (C.customer_lifecycle.notna()&(C.lifecycle!="Customer")).sum())
p("Customer flagged icp_excluded TRUE", ((C.lifecycle=="Customer")&(C.icp_excluded=="TRUE")).sum())
p("Invest/Partner/Media with lifecycle Customer/Prospect", (C.business_relationship_type.ne("Sales")&C.lifecycle.isin(["Customer","Prospect"])).sum())
arr=pd.to_numeric(C.arr_signed_eur,errors="coerce"); p("sum arr_signed_eur (Customers)", round(arr[C.lifecycle=="Customer"].sum()))
gp=C.merge(C[["record_id","arr_signed_eur"]].rename(columns={"record_id":"parent_record_id","arr_signed_eur":"parr"}),on="parent_record_id")
p("child & parent both carry ARR (double count risk)", (gp.arr_signed_eur.notna()&gp.parr.notna()).sum())
left=set(T[T.status=="Left"].name); known=set(T.name)
for c in ["sales_owner","sdr_owner","am_owner"]:
    p(f"{c} owned by Left rep / not in team", f"{C[c].isin(left).sum()} / {(C[c].notna()&~C[c].isin(known)).sum()}")
p("sales_owner who is SDR", C.sales_owner.isin(T[T.role=='SDR'].name).sum())
print("practitioners numeric stats:", pd.to_numeric(C.practitioners,errors="coerce").describe().round(0).to_dict())
print("created_by:", C.created_by.value_counts(dropna=False).head(12).to_dict())
print("=== CONTACTS")
p("company_record_id empty", P.company_record_id.isna().sum()); p("company_record_id not found", (P.company_record_id.notna()&~P.company_record_id.isin(ids)).sum())
r=P.rpps.dropna(); print("rpps length dist:", r.str.len().value_counts().to_dict())
p("rpps duplicated", f"{r.duplicated(keep=False).sum()} rows / {r[r.duplicated(keep=False)].nunique()} rpps")
p("rpps on non-Practitioner category", (P.rpps.notna()&P.category.ne("Practitioner")).sum())
print("   ...by category:", P[P.rpps.notna()].category.value_counts(dropna=False).to_dict())
p("Practitioner without rpps", ((P.category=="Practitioner")&P.rpps.isna()).sum())
em=P.email_addresses.dropna().str.split(r",\s*").explode().str.lower()
p("emails shared by >1 contact", f"{em.duplicated(keep=False).sum()} / {em[em.duplicated(keep=False)].nunique()} emails")
p("emails invalid format", (~em.str.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}")).sum())
edom=em.str.split("@").str[1]
gen={"gmail.com","hotmail.fr","hotmail.com","yahoo.fr","orange.fr","wanadoo.fr","free.fr","outlook.fr","outlook.com","laposte.net","sfr.fr","icloud.com","live.fr","yahoo.com"}
p("emails on webmail domains", edom.isin(gen).sum()); print("  top email domains:", edom.value_counts().head(8).to_dict())
P["nk"]=P.first_name.map(norm).fillna("")+P.last_name.map(norm).fillna("")
p("dup first+last+company", (P.nk+P.company_record_id.fillna("")).duplicated(keep=False).sum())
p("same first+last on different companies", P.groupby("nk").company_record_id.nunique().gt(1).sum())
# contact email domain vs company domain
cd=C[["record_id","domains"]].dropna(); cd=cd.assign(dom=cd.domains.str.split(r",\s*")).explode("dom"); cd["dom"]=cd.dom.str.lower().str.replace(r"^www\.","",regex=True)
dom2co=cd.groupby("dom").record_id.apply(set).to_dict(); co2dom=cd.groupby("record_id").dom.apply(set).to_dict()
E=P[["record_id","company_record_id","email_addresses"]].dropna(subset=["email_addresses"]).copy()
E["edom"]=E.email_addresses.str.split(r",\s*").str[0].str.split("@").str[1].str.lower()
E=E[~E.edom.isin(gen)]
E["co_has_dom"]=E.company_record_id.map(lambda x: x in co2dom)
E["match"]=E.apply(lambda r: r.edom in co2dom.get(r.company_record_id,set()),axis=1)
E["other"]=E.apply(lambda r: (not r.match) and r.edom in dom2co,axis=1)
p("pro-email contacts whose company has domains", E.co_has_dom.sum())
p("  ...email domain == company domain", (E.co_has_dom&E.match).sum())
p("  ...email domain belongs to ANOTHER company (wrong account)", (E.other).sum())
# contacts specialty vs company specialty, Ophtalmology spelling
print("contact specialty:", P.specialty.value_counts(dropna=False).to_dict())
print("contact type values:", P.type.value_counts(dropna=False).to_dict())
p("contacts per company: companies with 0 contacts", (~C.record_id.isin(P.company_record_id)).sum())
print("contacts/company top:", P.company_record_id.value_counts().head(5).tolist())
p("contacts on Group/Superorga", P.company_record_id.map(dict(zip(C.record_id,C.type))).isin(["Group","Superorga"]).sum())
print("contacts created_by:", P.created_by.value_counts().head(10).to_dict())
p("phones shared across contacts", P.phone_numbers.dropna().str.split(r",\s*").explode().duplicated(keep=False).sum())
