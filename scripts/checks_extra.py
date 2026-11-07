"""Follow-up checks: bulk clean-up dates, forecast outliers, wrong-account contacts by account family.

Usage: python scripts/checks_extra.py <data_dir>
"""
import sys, pandas as pd
d=sys.argv[1]
D=pd.read_csv(f"{d}/deals.csv",dtype=str); C=pd.read_csv(f"{d}/companies.csv",dtype=str); P=pd.read_csv(f"{d}/contacts.csv",dtype=str)
for c in ["created_at","signed_date","close_date","demo_held_date"]: D[c]=pd.to_datetime(D[c],errors="coerce",utc=True)
D["signed_arr"]=pd.to_numeric(D.signed_arr,errors="coerce"); D["forecasted_arr"]=pd.to_numeric(D.forecasted_arr,errors="coerce")
t=D[D.loss_reason=="Too much time with no sales actions"]
print("'Too much time' close_date top days:", t.close_date.dt.date.value_counts().head(6).to_dict(), "| created_by:", t.created_by.value_counts(dropna=False).head(3).to_dict())
w=D[D.stage=="Closed Won"]
gap=(w.close_date-w.signed_date).dt.days
print("won close_date - signed_date days:", gap.describe().round(0).to_dict())
print("won close_date month != signed month:", (w.close_date.dt.to_period('M')!=w.signed_date.dt.to_period('M'))[w.signed_date.notna()].sum())
print("forecasted_arr top:", D.forecasted_arr.nlargest(5).tolist())
print(D.loc[D.forecasted_arr.nlargest(3).index,["deal_name","stage","owner","forecasted_arr","signed_arr","currency"]].to_string())
o=D[~D.stage.isin(["Closed Won","Closed Lost"])]
print("open pipeline forecasted_arr sum:", round(o.forecasted_arr.sum()), "| without top outlier:", round(o.forecasted_arr[o.forecasted_arr<1e6].sum()))
# wrong-account refined: email domain owned by another company not in same family
par=dict(zip(C.record_id,C.parent_record_id))
def root(x):
    seen=set()
    while isinstance(par.get(x),str) and x not in seen: seen.add(x); x=par[x]
    return x
cd=C[["record_id","domains"]].dropna(); cd=cd.assign(dom=cd.domains.str.split(r",\s*")).explode("dom"); cd["dom"]=cd.dom.str.lower().str.replace(r"^www\.","",regex=True)
gen={"gmail.com","hotmail.fr","hotmail.com","yahoo.fr","orange.fr","wanadoo.fr","free.fr","outlook.fr","outlook.com","laposte.net","sfr.fr","icloud.com","live.fr","yahoo.com","doctolib.fr","maiia.com","pagesjaunes.fr"}
cd=cd[~cd.dom.isin(gen)]
dom2roots=cd.groupby("dom").record_id.apply(lambda s:{root(x) for x in s}).to_dict(); co2dom=cd.groupby("record_id").dom.apply(set).to_dict()
E=P.dropna(subset=["email_addresses","company_record_id"]).copy()
E["edom"]=E.email_addresses.str.split(r",\s*").str[0].str.split("@").str[1].str.lower()
E=E[~E.edom.isin(gen) & E.edom.isin(dom2roots)]
E["r"]=E.company_record_id.map(root)
E["wrong"]=E.apply(lambda r: r.r not in dom2roots[r.edom],axis=1)
print("contacts whose pro email domain maps to a company in ANOTHER family (true wrong account):", E.wrong.sum(), "of", len(E))
# deals: same account, overlapping open/new deals
o2=D[D.type=="New"].groupby("company_record_id").agg(n=("record_id","size"),won=("stage",lambda s:(s=="Closed Won").sum()),opn=("stage",lambda s:(~s.isin(["Closed Won","Closed Lost"])).sum()))
print("accounts with >=2 open New deals:", (o2.opn>=2).sum(), "| New deal open on account already won:", ((o2.won>=1)&(o2.opn>=1)).sum())
print("deals on Superorga/Group:", D.company_record_id.map(dict(zip(C.record_id,C.type))).value_counts(dropna=False).to_dict())
