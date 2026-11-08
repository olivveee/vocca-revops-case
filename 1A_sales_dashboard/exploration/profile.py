"""Fill rate and value distribution of every column in deals, companies and contacts.

Usage: python 1A_sales_dashboard/exploration/profile.py <data_dir>
"""
import sys, pandas as pd
d = sys.argv[1]
for f in ["deals","companies","contacts"]:
    df = pd.read_csv(f"{d}/{f}.csv", dtype=str)
    print(f"\n===== {f}: {len(df)} rows")
    fill = (df.notna().mean()*100).round(0).astype(int)
    nun = df.nunique()
    for c in df.columns:
        top = df[c].value_counts().head(6)
        tops = "; ".join(f"{k}={v}" for k,v in top.items()) if nun[c] <= 40 else ""
        print(f"  {c:32s} fill={fill[c]:3d}% uniq={nun[c]:5d}  {tops[:220]}")
