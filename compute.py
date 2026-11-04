"""Compute every number the dealer dashboard needs, from the tab CSVs.

Outputs metrics.json used by (a) the HTML preview and (b) cross-checking the
Apps Script implementation.
"""
from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
CSV = HERE / "csv"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def rd(name: str) -> pd.DataFrame:
    return pd.read_csv(CSV / f"{name}.csv", low_memory=False)


def num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s, errors="coerce")


def money(s: pd.Series) -> pd.Series:
    return pd.to_numeric(
        s.astype(str).str.replace("Rs.", "", regex=False).str.replace(",", "", regex=False),
        errors="coerce",
    )


def clean_rto(x: str) -> str:
    if not isinstance(x, str):
        return ""
    t = re.sub(r"\(\s*JK\s*-?\s*\d*\s*\)", "", x, flags=re.I)
    t = re.sub(r"\s+(?:ARTO|RTO)\s*$", "", t, flags=re.I)
    t = re.sub(r"\b(A|R)TO\b", "", t, flags=re.I)
    return t.strip().strip("-").strip().upper()


def month_key(x) -> str | None:
    if not isinstance(x, str):
        return None
    t = x.strip()[:3].title()
    return t if t in MONTHS else None


# ----------------------------------------------------------------- sales core
both = rd("BOTH DATA")
both["STATUS"] = both["STATUS"].astype(str).str.strip().str.upper()
both["year"] = num(both["year"]).astype("Int64")
both["month"] = both["month"].map(month_key)

# model recovery: VAHAN / partial rows arrive without Parent Product Line, so
# look the chassis up in the off-take and billing registers first.
_br0 = rd("BILLING REGISTER MIS")
_ot0 = rd("OFF TAKE REPORT MIS")
chassis_model: dict[str, str] = {}
for src, ck, mk in ((_ot0, "Chassis No.", "Parent Product Line"), (_br0, "Chassis No", "Parent Product Line")):
    for c, m in zip(src[ck], src[mk]):
        if isinstance(m, str) and m.strip() and isinstance(c, str) and c not in chassis_model:
            chassis_model[c.strip()] = m.strip()

both["ppl"] = both["Parent Product Line"].fillna(both["Chassis No"].astype(str).str.strip().map(chassis_model))
both["ppl"] = both["ppl"].fillna("Unmapped").astype(str).str.strip()
both["pl"] = both["PL"].fillna("").astype(str).str.strip()

years = sorted(int(y) for y in both["year"].dropna().unique())
CY, LY = years[-1], years[-2]

monthly = {st: {y: {m: 0 for m in MONTHS} for y in years}
           for st in ["RETAIL", "WHOLESALE", "VAHAN"]}
for st, y, m, n in both.groupby(["STATUS", "year", "month"]).size().reset_index(name="n").itertuples(index=False):
    if st in monthly and pd.notna(y) and m:
        monthly[st][int(y)][m] = int(n)

yearly = {st: {y: sum(monthly[st][y].values()) for y in years} for st in monthly}

# model x year, retail
model_cy, model_ly, model_cy_whole = Counter(), Counter(), Counter()
for r in both.itertuples(index=False):
    if r.year == CY:
        if r.STATUS == "RETAIL":
            model_cy[r.ppl] += 1
        elif r.STATUS == "WHOLESALE":
            model_cy_whole[r.ppl] += 1
    elif r.year == LY and r.STATUS == "RETAIL":
        model_ly[r.ppl] += 1


def growth(cur: float, prev: float):
    if prev in (0, None):
        return None
    return (cur - prev) / prev


# ----------------------------------------------------------------- billing
br = rd("BILLING REGISTER MIS")
br = br.dropna(subset=["Invoice Number", "Invoice Date"], how="all")
br["d"] = pd.to_datetime(br["Invoice Date"], errors="coerce")
br["y"] = br["d"].dt.year
br["margin"] = money(br["Total Dealer Margin"])
br["base"] = money(br["Base Price"])
br["fin"] = br["Financier"].astype(str).str.strip().str.upper().replace({"": "Not recorded", "NAN": "Not recorded"})
br["sp"] = br["Sales Person"].astype(str).str.strip().str.upper().replace({"": "Not recorded", "NAN": "Not recorded"})
br["outlet"] = br["Opportunity Division Name"].fillna("").astype(str).str.strip()
br["district"] = br["Contact Address Details"].fillna("").astype(str).str.split(",").str[0].str.strip().str.upper()

br_cy = br[br["y"] == CY]
fin_all = Counter(br["fin"]); fin_cy = Counter(br_cy["fin"])
sp_cy = Counter(br_cy["sp"]); sp_all = Counter(br["sp"])
dist_cy = Counter(br_cy["district"])
margin_cy = float(br_cy["margin"].sum())
margin_all = float(br["margin"].sum())
avg_margin_cy = margin_cy / len(br_cy) if len(br_cy) else 0
cash_disc = None

bc = rd("BILLING SHEET DEALER CA WISE")
bc["disc"] = num(bc["CASH DISCOUNT"])
ca_bill_cy = Counter(bc["SC/TL"].fillna("Not recorded").astype(str).str.strip().str.upper())
bc_month = bc["Column 13"].fillna("").astype(str)
bc["y"] = num(bc_month.str.extract(r"(\d{4})")[0])
ca_bill_cy_year = Counter(bc.loc[bc["y"] == CY, "SC/TL"].fillna("Not recorded").astype(str).str.strip().str.upper())

# ----------------------------------------------------------------- off-take
ot = rd("OFF TAKE REPORT MIS")
ot["d"] = pd.to_datetime(ot["TM Invoice Date"], errors="coerce")
ot["y"] = ot["d"].dt.year
ot["m"] = ot["d"].dt.month
ot["age"] = num(ot["Chassis Age (# Days)"])
ot["phys"] = ot["Physical Status"].fillna("Not recorded").astype(str).str.strip()
ot["ppl2"] = ot["Parent Product Line"].fillna("Not recorded").astype(str).str.strip()

ofm = {y: {m: 0 for m in MONTHS} for y in (LY, CY)}
for y, m, n in ot.dropna(subset=["y"]).groupby(["y", "m"]).size().reset_index(name="n").itertuples(index=False):
    if int(y) in ofm and 1 <= int(m) <= 12:
        ofm[int(y)][MONTHS[int(m) - 1]] = int(n)

phys = Counter(ot["phys"])
age_bucket = Counter()
for a in ot["age"].dropna():
    if a <= 30:
        age_bucket["0-30 days"] += 1
    elif a <= 60:
        age_bucket["31-60 days"] += 1
    elif a <= 90:
        age_bucket["61-90 days"] += 1
    elif a <= 180:
        age_bucket["91-180 days"] += 1
    else:
        age_bucket["180+ days"] += 1
vahan_ok = int((ot["VAHAN Upload Status"].astype(str).str.upper() == "SUCCESS").sum())
vahan_lic = int(ot["License Number"].notna().sum())

# ----------------------------------------------------------------- stock
ov = rd("ORDER VEHICLES")
ov["cnt"] = num(ov["count"])
ov["stk"] = num(ov["STOCK COUNT"]).fillna(0)
ov = ov[ov["cnt"].notna()]
stock = defaultdict(lambda: [0, 0])
for r in ov.itertuples(index=False):
    k = str(r.MODEL).strip()
    stock[k][0] += int(r.cnt)
    stock[k][1] += int(r.stk)
stock_rows = sorted(((k, v[0], v[1]) for k, v in stock.items()), key=lambda x: -x[1])
stock_total = sum(v[1] for v in stock.values())

# ----------------------------------------------------------------- RTO (own)
sm = rd("SMAM RTO SHEET")
sm["d"] = pd.to_datetime(sm["Receipt Date"], errors="coerce")
sm["y"] = sm["d"].dt.year
sm["office"] = sm["Office Name"].fillna("").astype(str).str.strip()
sm["office_key"] = sm["office"].map(clean_rto)
st = sm["Status"].fillna("").astype(str).str.strip().str.upper()
sm["state"] = st.where(st.isin(["APPROVED", "PENDING AT APPROVE"]), "OTHER")
sm["fees"] = num(sm["Fees in (Rs.)"]).fillna(0)
sm["tax"] = num(sm["MV Tax in (Rs.)"]).fillna(0)

office_tbl = {}
for key, grp in sm.groupby("office_key"):
    if not key:
        continue
    office_tbl[key] = {
        "reg": int(len(grp)),
        "approved": int((grp["state"] == "APPROVED").sum()),
        "pending": int((grp["state"] == "PENDING AT APPROVE").sum()),
        "fees": float(grp["fees"].sum()),
        "tax": float(grp["tax"].sum()),
    }
office_tbl = dict(sorted(office_tbl.items(), key=lambda kv: -kv[1]["reg"]))

sm_month = {y: {m: 0 for m in MONTHS} for y in sorted(sm["y"].dropna().unique())}
for y, m, n in sm.dropna(subset=["y"]).groupby(["y", sm["d"].dt.month]).size().reset_index(name="n").itertuples(index=False):
    sm_month[int(y)][MONTHS[int(m) - 1]] = int(n)

status_split = {"APPROVED": int((sm["state"] == "APPROVED").sum()),
                "PENDING AT APPROVE": int((sm["state"] == "PENDING AT APPROVE").sum()),
                "OTHER/ADDRESS ROWS": int((sm["state"] == "OTHER").sum())}

# ----------------------------------------------------------------- market
j = rd("JAMMU DIVISION RTO SHEET")
j["COUNT"] = num(j["COUNT"]).fillna(0)
j["Maker"] = j["Maker"].astype(str).str.strip().str.upper()
j["RTOk"] = j["RTO"].map(clean_rto)
j["y"] = num(j["YEAR"])
tata = j[j["Maker"].str.startswith("TATA")]
ind_year = j.groupby("y")["COUNT"].sum()
tat_year = tata.groupby("y")["COUNT"].sum()
smam_year = sm.groupby("y").size()

market_year = []
for y in years:
    ind = float(ind_year.get(y, 0))
    tat = float(tat_year.get(y, 0))
    own = int(smam_year.get(y, 0))
    market_year.append({
        "year": y, "industry": ind, "tata": tat, "smam": own,
        "tata_share": (tat / ind * 100) if ind else None,
        "smam_of_tata": (own / tat * 100) if tat else None,
        "smam_of_industry": (own / ind * 100) if ind else None,
    })

jcy = j[j["y"] == CY]
tcy = tata[tata["y"] == CY]
rto_tbl = {}
for rto, grp in jcy.groupby("RTOk"):
    rto_tbl[rto] = {"industry": float(grp["COUNT"].sum()), "tata": 0.0, "smam": 0}
for rto, grp in tcy.groupby("RTOk"):
    rto_tbl.setdefault(rto, {"industry": 0.0, "tata": 0.0, "smam": 0})["tata"] = float(grp["COUNT"].sum())
for rto, n in sm[sm["y"] == CY].groupby("office_key").size().items():
    rto_tbl.setdefault(rto, {"industry": 0.0, "tata": 0.0, "smam": 0})["smam"] = int(n)
for rto, v in rto_tbl.items():
    v["tata_share"] = (v["tata"] / v["industry"] * 100) if v["industry"] else None
    v["smam_of_tata"] = (v["smam"] / v["tata"] * 100) if v["tata"] else None
rto_tbl = dict(sorted([kv for kv in rto_tbl.items() if kv[1]["industry"] > 0], key=lambda kv: -kv[1]["industry"]))

sr = rd("SRINAGAR DIVISION RTO SHEET")
sr["COUNT"] = num(sr["COUNT"]).fillna(0)
sr["Maker"] = sr["Maker"].astype(str).str.strip().str.upper()
sr["RTOk"] = sr["RTO"].map(clean_rto)
sr_ind = float(sr["COUNT"].sum())
sr_tat = float(sr[sr["Maker"].str.startswith("TATA")]["COUNT"].sum())
sr_rto = {k: float(g["COUNT"].sum()) for k, g in sr.groupby("RTOk")}
sr_rto = dict(sorted(sr_rto.items(), key=lambda kv: -kv[1]))

# ----------------------------------------------------------------- CA / sales
ca = rd("RTO SHEET DEALER CA WISE")
ca["d"] = pd.to_datetime(ca["DATE"], errors="coerce")
ca["y"] = ca["d"].dt.year
ca["sc"] = ca["SC"].fillna("Not recorded").astype(str).str.strip().str.upper()
ca["outlet"] = ca["OUTLET"].fillna("Not recorded").astype(str).str.strip().str.upper()
ca_cy = Counter(ca.loc[ca["y"] == CY, "sc"])
ca_outlet = Counter(ca["outlet"])

# ----------------------------------------------------------------- health
health = [
    ["BOTH DATA", len(both), str(both["INVOICE DATE"].dropna().max())[:10]],
    ["BILLING REGISTER MIS", len(br), str(br["d"].max())[:10]],
    ["OFF TAKE REPORT MIS", len(ot), str(ot["d"].max())[:10]],
    ["ORDER VEHICLES", len(ov), "(no date)"],
    ["SMAM RTO SHEET", len(sm), str(sm["d"].max())[:10]],
    ["JAMMU DIVISION RTO SHEET", len(j), f"{int(j['y'].min())}-{int(j['y'].max())}"],
    ["SRINAGAR DIVISION RTO SHEET", len(sr), "2026"],
    ["TATA MOTORS REST DEALER AND SMA", 3414, "2024-2026"],
    ["RTO SHEET DEALER CA WISE", len(ca), str(ca["d"].max())[:10]],
    ["BILLING SHEET DEALER CA WISE", len(bc), "2024-2026"],
]

VALLEY = ["SRINAGAR", "ANANTNAG", "BARAMULLA", "BUDGAM", "PULWAMA",
          "KUPWARA", "GANDERBAL", "BANDIPORA", "KULGAM", "SHOPIAN"]
valley = int(sm[(sm["y"] == CY) &
                sm["office"].astype(str).str.upper().str.contains("|".join(VALLEY))].shape[0])

# ---- TATA rest dealer vs SMA count tab (visible)
tr = rd("TATA MOTORS REST DEALER AND SMA")
tr["COUNT"] = num(tr["COUNT"]).fillna(0)
tr["y"] = num(tr["YEAR"])
tr["st"] = tr["STATUS"].astype(str).str.strip().str.upper()
tatarest = []
for y in sorted(int(v) for v in tr["y"].dropna().unique()):
    g = tr[tr["y"] == y]
    smam = float(g.loc[g["st"] == "SMAM COUNT", "COUNT"].sum())
    overall = float(g.loc[g["st"] == "OVER ALL COUNT", "COUNT"].sum())
    tatarest.append({"year": y, "smam": smam, "overall": overall,
                     "share": (smam / overall) if overall else None})

M = {
    "generated": datetime.now().strftime("%d %b %Y %H:%M"),
    "years": years, "CY": CY, "LY": LY, "months": MONTHS,
    "monthly": monthly, "yearly": yearly,
    "model_cy": dict(model_cy.most_common(25)),
    "model_ly": dict(model_ly),
    "model_wholesale_cy": dict(model_cy_whole.most_common(25)),
    "fin_all": dict(fin_all.most_common(10)),
    "fin_cy": dict(fin_cy.most_common(10)),
    "sp_cy": dict(sp_cy.most_common(10)),
    "district_cy": dict(dist_cy.most_common(8)),
    "margin_cy": margin_cy, "margin_all": margin_all, "avg_margin_cy": avg_margin_cy,
    "billing_rows": len(br), "billing_rows_cy": len(br_cy),
    "cash_disc": float(bc["disc"].sum()),
    "offtake": ofm, "phys": dict(phys.most_common()), "age": dict(age_bucket),
    "vahan_ok": vahan_ok, "vahan_lic": vahan_lic, "offtake_rows": len(ot),
    "stock_total": stock_total, "stock_rows": [list(x) for x in stock_rows],
    "stock_billing": int(sum(x[1] for x in stock_rows)),
    "office_tbl": office_tbl,
    "sm_month": sm_month, "status_split": status_split,
    "market_year": market_year, "rto_tbl": rto_tbl,
    "sr_ind": sr_ind, "sr_tat": sr_tat, "sr_rto": sr_rto,
    "ca_bill_cy": dict(ca_bill_cy_year.most_common(10)),
    "ca_bill_all": dict(ca_bill_cy.most_common(10)),
    "ca_reg_cy": dict(ca_cy.most_common(10)),
    "ca_outlet": dict(ca_outlet.most_common()),
    "health": health,
    "sm_rows": len(sm), "tatarest": tatarest, "valley": valley,
}
def fixkeys(d):
    out = {}
    for k, v in d.items():
        key = "Not recorded" if str(k).strip().upper() in ("", "NAN", "NONE") else k
        out[key] = v
    return out


for _k in ("fin_all", "fin_cy", "sp_cy", "district_cy", "ca_bill_cy", "ca_reg_cy"):
    M[_k] = fixkeys(M[_k])


def clean(o):
    if isinstance(o, dict):
        return {(k.item() if hasattr(k, "item") else k): clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [clean(v) for v in o]
    if hasattr(o, "item"):
        return o.item()
    return o


(HERE / "metrics.json").write_text(json.dumps(clean(M), indent=1, default=str), encoding="utf-8")

# ---------------------------------------------------------------- console QA
print("YEARS", years, "CY", CY, "LY", LY)
print("YEARLY", yearly)
print("2026 monthly retail", monthly["RETAIL"][CY])
print("model CY top", list(model_cy.most_common(8)))
print("market", market_year)
print("RTO", list(rto_tbl.items())[:4])
print("stock", stock_total, "offtake CY", sum(ofm[CY].values()), "LY", sum(ofm[LY].values()))
print("margin CY", round(margin_cy), "rows CY", len(br_cy), "avg", round(avg_margin_cy))
print("CA billing CY top", ca_bill_cy_year.most_common(5))
print("CA reg CY top", ca_cy.most_common(5))


