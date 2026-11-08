"""Test the candidate 1A metrics per AE over the last 6 complete months.

Usage: python 1A_sales_dashboard/exploration/metrics_test.py <data_dir>
"""
import sys, pandas as pd
d = sys.argv[1]
D = pd.read_csv(f"{d}/deals.csv", dtype=str); T = pd.read_csv(f"{d}/sales_team.csv", dtype=str)
for c in ["created_at","demo_held_date","signed_date","close_date"]: D[c] = pd.to_datetime(D[c], errors="coerce", utc=True).dt.tz_localize(None)
for c in ["forecasted_arr","signed_arr"]: D[c] = pd.to_numeric(D[c], errors="coerce")
won = D.stage.eq("Closed Won"); lost = D.stage.eq("Closed Lost")
sweep = lost & D.loss_reason.eq("Too much time with no sales actions")
D["booking_date"] = D.signed_date.where(D.signed_date.notna(), D.close_date)
D["arr_won"] = D.signed_arr.where(D.signed_arr > 0, D.forecasted_arr).where(won)
D["new_logo"] = D.type.eq("New") & D.source.ne("Group Rollout")
D["is_closed"] = won | lost
reached_demo = D.stage.isin(["Demo Held","Qualified","Quoted","Closed Won"]) | (lost & D.closed_lost_step.isin(["Demo completed","Proposal sent"]))
D["reached_demo"] = reached_demo
P = D.booking_date.dt.to_period("M")
win = (P >= "2026-03") & (P <= "2026-08")
ae = T[T.role.eq("AE")].name
rows = []
for o in ae:
    x = D[D.owner.eq(o)]; xw = x[win.loc[x.index]]
    closed = xw[xw.is_closed & ~sweep.loc[xw.index]]
    rows.append(dict(ae=o,
        new_arr_6m=round(xw.arr_won[xw.new_logo].sum()), exp_arr_6m=round(xw.arr_won[~xw.new_logo].sum()),
        won_6m=int((xw.stage=="Closed Won").sum()), closed_excl_sweep=len(closed),
        win_rate=round((closed.stage=="Closed Won").mean()*100) if len(closed) else None,
        sweep_lost=int(sweep.loc[x.index].sum()),
        avg_deal=round(xw.arr_won.mean()) if xw.arr_won.notna().any() else None,
        cycle_days_med=round((xw.booking_date - xw.created_at).dt.days[xw.stage=="Closed Won"].median()) if (xw.stage=="Closed Won").any() else None,
        open_deals=int((~x.is_closed).sum()), open_pipe=round(x.forecasted_arr[~x.is_closed].sum()),
        open_gt90d=int(((~x.is_closed) & (x.created_at < pd.Timestamp("2026-06-27"))).sum())))
R = pd.DataFrame(rows).merge(T[["name","status","start_date","monthly_new_arr_quota_synthetic"]], left_on="ae", right_on="name").drop(columns="name")
R["attain_%"] = (R.new_arr_6m / (pd.to_numeric(R.monthly_new_arr_quota_synthetic)*6) * 100).round(0)
pd.set_option("display.width", 250); print(R.to_string(index=False))
print("\nMonthly team new-logo ARR (bookings):")
print(D[won & D.new_logo].groupby(P)["arr_won"].sum().round(0).tail(12).to_string())
