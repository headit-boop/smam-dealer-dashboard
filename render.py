"""Render the public GitHub Pages dashboard from metrics.json."""
from __future__ import annotations

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
M = json.loads((HERE / "metrics.json").read_text(encoding="utf-8"))

MONTHS = M["months"]
CY, LY = M["CY"], M["LY"]
ACTIVE = [m for m in MONTHS if M["monthly"]["RETAIL"][str(CY)][m]
          or M["monthly"]["WHOLESALE"][str(CY)][m]
          or M["monthly"]["VAHAN"][str(CY)][m]]


def n(x, d=0):
    if x is None or x == "":
        return "–"
    return f"{x:,.{d}f}"


def pct(x, d=1, sign=False):
    if x is None:
        return "–"
    return f"{x:+.{d}f}%" if sign else f"{x:.{d}f}%"


def inr(x):
    if not x:
        return "₹0"
    if x >= 1e7:
        return f"₹{x/1e7:,.2f} Cr"
    if x >= 1e5:
        return f"₹{x/1e5:,.2f} L"
    return f"₹{x:,.0f}"


def growth(a, b):
    if not a or not b:
        return None
    return (a - b) / b


R, W, V = M["monthly"]["RETAIL"], M["monthly"]["WHOLESALE"], M["monthly"]["VAHAN"]


def ytd(series, year):
    return sum(series[str(year)][m] for m in ACTIVE)


ret_cy, ret_ly = ytd(R, CY), ytd(R, LY)
who_cy, who_ly = ytd(W, CY), ytd(W, LY)
vah_cy, vah_ly = ytd(V, CY), ytd(V, LY)
off = M["offtake"]
off_cy = sum(off[str(CY)][m] for m in ACTIVE)
off_ly = sum(off[str(LY)][m] for m in ACTIVE)

mkt = {r["year"]: r for r in M["market_year"]}
mcy, mly = mkt.get(CY, {}), mkt.get(LY, {})
pending = M["status_split"].get("PENDING AT APPROVE", 0)

KPI = [
    ("Retail · YTD", n(ret_cy), growth(ret_cy, ret_ly), "units delivered", "#0A4C95"),
    ("Wholesale · YTD", n(who_cy), growth(who_cy, who_ly), "units billed", "#128C7E"),
    ("VAHAN · YTD", n(vah_cy), growth(vah_cy, vah_ly), "registrations", "#6C4AB6"),
    ("Off-take · YTD", n(off_cy), growth(off_cy, off_ly), "TM invoices", "#E07B00"),
    ("TATA share · Jammu div.", pct(mcy.get("tata_share"), 2), growth(mcy.get("tata_share"), mly.get("tata_share")), "of industry PV", "#0A4C95"),
    ("SMA share of TATA", pct(mcy.get("smam_of_tata")), growth(mcy.get("smam_of_tata"), mly.get("smam_of_tata")), "our slice of TATA", "#C0392B"),
    ("Dealer margin · YTD", inr(M["margin_cy"]), None, f"avg {inr(M['avg_margin_cy'])}/unit", "#1E8E5A"),
    ("Pending registrations", n(pending), None, "waiting at RTO/ARTO", "#5B6B82"),
]


def kpi_html():
    out = []
    for label, value, g, sub, color in KPI:
        chip = ""
        if g is not None and abs(g) < 100:
            chip = f'<span class="chip {"up" if g >= 0 else "down"}">{"▲" if g >= 0 else "▼"} {abs(g)*100:.1f}%</span>'
        out.append(f'<div class="kpi" style="--c:{color}"><div class="k-label">{label}</div>'
                   f'<div class="k-value">{value}</div>'
                   f'<div class="k-foot">{chip}<span class="k-sub">{sub}</span></div></div>')
    return "".join(out)


def monthly_chart():
    mx = max([max(R[str(CY)].values()), max(W[str(CY)].values()), max(V[str(CY)].values())] or [1]) or 1
    bars = []
    for m in MONTHS:
        r, w, v = R[str(CY)][m], W[str(CY)][m], V[str(CY)][m]
        bars.append(
            f"<div class='gbar'><div class='stack'>"
            f"<i style='height:{r/mx*100:.1f}%;background:#0A4C95'></i>"
            f"<i style='height:{w/mx*100:.1f}%;background:#128C7E'></i>"
            f"<i style='height:{v/mx*100:.1f}%;background:#8E7CC3'></i>"
            f"</div><span>{m}</span></div>")
    return ("<div class='chart'><div class='legend'>"
            "<b style='background:#0A4C95'></b>Retail <b style='background:#128C7E'></b>Wholesale "
            "<b style='background:#8E7CC3'></b>VAHAN</div>"
            f"<div class='bars'>{''.join(bars)}</div></div>")


def monthly_table():
    rows = []
    for m in MONTHS:
        has = m in ACTIVE
        r, w, v, rl = R[str(CY)][m], W[str(CY)][m], V[str(CY)][m], R[str(LY)][m]
        g = growth(r, rl) if has else None
        rows.append(
            f"<tr><td class='l'>{m}</td><td>{r if has else '–'}</td><td>{w if has else '–'}</td>"
            f"<td>{v if has else '–'}</td><td class='dim'>{rl if has else '–'}</td>"
            f"<td class='{'pos' if (g or 0) >= 0 else 'neg'}'>{pct(g*100) if g is not None else '–'}</td></tr>")
    g = growth(ret_cy, ret_ly)
    rows.append(f"<tr class='tot'><td class='l'>TOTAL</td><td>{ret_cy}</td><td>{who_cy}</td>"
                f"<td>{vah_cy}</td><td>{ret_ly}</td>"
                f"<td class='{'pos' if (g or 0) >= 0 else 'neg'}'>{pct(g*100) if g else '–'}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Month</th>"
            f"<th>Retail {CY}</th><th>Wholesale {CY}</th><th>VAHAN {CY}</th>"
            f"<th class='dim'>Retail {LY}</th><th>Growth</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def model_table():
    models = list(M["model_cy"].items())[:10]
    total = ret_cy or 1
    rows = []
    for name, v in models:
        ly = M["model_ly"].get(name, 0)
        g = growth(v, ly)
        rows.append(
            f"<tr><td class='l'>{name}</td><td>{v}</td><td class='dim'>{ly or '–'}</td>"
            f"<td class='{'pos' if (g or 0) >= 0 else 'neg'}'>{pct(g*100) if g is not None else 'new'}</td>"
            f"<td class='num'>{v/total*100:.1f}%</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Model</th>"
            f"<th>Retail {CY}</th><th class='dim'>Retail {LY}</th><th>Growth</th>"
            "<th>Share</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def matrix_table():
    rows = []
    for m in MONTHS:
        r25, w25, v25 = R[str(LY)][m], W[str(LY)][m], V[str(LY)][m]
        r26, w26, v26 = R[str(CY)][m], W[str(CY)][m], V[str(CY)][m]
        g = growth(r26, r25)
        rows.append(f"<tr><td class='l'>{m}</td><td>{r25 or '–'}</td><td>{w25 or '–'}</td>"
                    f"<td>{v25 or '–'}</td><td>{r26 or '–'}</td><td>{w26 or '–'}</td>"
                    f"<td>{v26 or '–'}</td>"
                    f"<td class='{'pos' if (g or 0) >= 0 else 'neg'}'>{pct(g*100) if g is not None else '–'}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Month</th>"
            f"<th>{LY} Retail</th><th>{LY} Whole.</th><th>{LY} VAHAN</th>"
            f"<th>{CY} Retail</th><th>{CY} Whole.</th><th>{CY} VAHAN</th>"
            "<th>Δ Retail</th></tr></thead><tbody>" + "".join(rows) + "</tbody></table>")


def bars_table(pairs, top=10, suffix=""):
    mx = max([v for _, v in pairs[:top]] or [1]) or 1
    rows = []
    for k, v in pairs[:top]:
        label = k.title() if k.isupper() else k
        rows.append(f"<tr><td class='l'>{label}</td><td class='num'>{n(v)}{suffix}</td>"
                    f"<td class='barcell'><span style='width:{v/mx*100:.0f}%'></span></td></tr>")
    return "<table class='grid compact'><tbody>" + "".join(rows) + "</tbody></table>"


def off_take_table():
    rows = []
    for m in MONTHS:
        has = m in ACTIVE
        a, b = off[str(CY)][m], off[str(LY)][m]
        g = growth(a, b) if has else None
        rows.append(f"<tr><td class='l'>{m}</td><td>{a if has else '–'}</td>"
                    f"<td class='dim'>{b if has else '–'}</td>"
                    f"<td class='{'pos' if (g or 0) >= 0 else 'neg'}'>{pct(g*100) if g is not None else '–'}</td></tr>")
    rows.append(f"<tr class='tot'><td class='l'>TOTAL</td><td>{off_cy}</td><td>{off_ly}</td>"
                f"<td class='{'pos' if off_cy >= off_ly else 'neg'}'>{pct(growth(off_cy, off_ly)*100)}</td></tr>")
    return ("<table class='grid compact'><thead><tr><th class='l'>Month</th>"
            f"<th>{CY}</th><th class='dim'>{LY}</th><th>Growth</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def office_table():
    rows = []
    for name, v in list(M["office_tbl"].items())[:12]:
        rows.append(
            f"<tr><td class='l'>{name.title()}</td><td>{v['reg']:,}</td><td>{v['approved']:,}</td>"
            f"<td class='{'warn' if v['pending'] else ''}'>{v['pending']:,}</td>"
            f"<td>{inr(v['fees'])}</td><td>{inr(v['tax'])}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Office</th><th>Regs</th>"
            "<th>Approved</th><th>Pending</th><th>Fees</th><th>MV tax</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def market_table():
    rows = []
    for r in M["market_year"]:
        if not r["industry"]:
            continue
        rows.append(
            f"<tr><td class='l'>{r['year']}</td><td>{r['industry']:,.0f}</td>"
            f"<td>{r['tata']:,.0f}</td><td>{r['smam']:,}</td>"
            f"<td>{pct(r['tata_share'])}</td>"
            f"<td class='{'pos' if (r['smam_of_tata'] or 0) >= 35 else ''}'>{pct(r['smam_of_tata'])}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Year</th><th>Industry</th>"
            "<th>TATA</th><th>SMA</th><th>TATA share</th><th>SMA of TATA</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def rto_table():
    rows = []
    for name, v in list(M["rto_tbl"].items())[:10]:
        ts = pct(v["tata_share"]) if v["tata_share"] else "–"
        ss = pct(v["smam_of_tata"]) if v["smam_of_tata"] else "–"
        rows.append(
            f"<tr><td class='l'>{name.title()}</td><td>{v['industry']:,.0f}</td>"
            f"<td>{v['tata']:,.0f}</td><td>{v['smam']:,}</td><td>{ts}</td>"
            f"<td class='barcell'><span style='width:{min(v['smam_of_tata'] or 0, 100):.0f}%'></span>{ss}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>RTO / ARTO</th><th>Industry</th>"
            "<th>TATA</th><th>SMA</th><th>TATA share</th><th>SMA of TATA</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


def tatarest_table():
    rows = []
    for r in M["tatarest"]:
        rows.append(f"<tr><td class='l'>{r['year']}</td><td>{r['smam']:,.0f}</td>"
                    f"<td>{r['overall']:,.0f}</td><td>{pct(r['share']*100 if r['share'] else None)}</td></tr>")
    return ("<table class='grid'><thead><tr><th class='l'>Year</th><th>SMAM count</th>"
            "<th>Overall TATA</th><th>Our share</th></tr></thead><tbody>"
            + "".join(rows) + "</tbody></table>")


CSS = """
*{box-sizing:border-box}
body{margin:0;background:#EEF2F7;font-family:"Segoe UI",Inter,system-ui,Arial,sans-serif;color:#12233B}
.wrap{max-width:1180px;margin:0 auto;padding:22px 24px 48px}
.top{background:linear-gradient(115deg,#0A2A50 0%,#0A4C95 55%,#1268C3 100%);color:#fff;
  border-radius:14px;padding:20px 26px;display:flex;justify-content:space-between;align-items:flex-end;
  box-shadow:0 10px 30px rgba(10,42,80,.18)}
.brand{font-size:11px;letter-spacing:3px;text-transform:uppercase;opacity:.78}
h1{margin:6px 0 4px;font-size:27px;font-weight:650;letter-spacing:-.4px}
.sub{opacity:.82;font-size:12.5px}
.stamp{text-align:right;font-size:11.5px;line-height:1.7;opacity:.92}
.stamp b{display:block;font-size:14px;letter-spacing:.3px}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0 4px}
.kpi{background:#fff;border-radius:11px;padding:12px 14px;border-left:4px solid var(--c);
  box-shadow:0 2px 8px rgba(18,35,59,.07)}
.k-label{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:#5B6B82;font-weight:600}
.k-value{font-size:25px;font-weight:680;margin:3px 0 2px;letter-spacing:-.5px;color:var(--c)}
.k-foot{display:flex;align-items:center;gap:8px;font-size:11px;color:#7A889C}
.chip{border-radius:20px;padding:1px 8px;font-weight:700;font-size:10.5px}
.chip.up{background:#E4F5EC;color:#1E8E5A}.chip.down{background:#FBE9E7;color:#C0392B}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.grid2a{display:grid;grid-template-columns:1.5fr 1fr;gap:16px;margin-top:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:16px}
.card{background:#fff;border-radius:12px;padding:14px 16px 12px;box-shadow:0 2px 10px rgba(18,35,59,.06)}
.card h2{margin:0 0 2px;font-size:13.5px;letter-spacing:.3px;display:flex;align-items:center;gap:8px}
.card h2 i{width:4px;height:14px;border-radius:2px;background:#0A4C95;display:inline-block}
.card .num{font-size:10.5px;letter-spacing:1px;color:#0A4C95;font-weight:700;margin-right:6px}
.card .hint{font-size:11px;color:#8A97A8;margin:0 0 10px}
table.grid{width:100%;border-collapse:collapse;font-size:12px}
table.grid th{text-align:right;font-size:10px;text-transform:uppercase;letter-spacing:.6px;
  color:#7A889C;border-bottom:1.5px solid #E3E9F1;padding:6px 8px;font-weight:700}
table.grid td{text-align:right;padding:5px 8px;border-bottom:1px solid #F0F4F9;font-variant-numeric:tabular-nums}
table.grid th.l,table.grid td.l{text-align:left}
table.grid tr.tot td{border-top:2px solid #E3E9F1;border-bottom:none;font-weight:700;background:#F8FAFD}
table.grid.compact td{padding:4px 8px}
.pos{color:#1E8E5A;font-weight:650}.neg{color:#C0392B;font-weight:650}
.dim{color:#8A97A8}.warn{color:#D97706;font-weight:650}.num{text-align:right}
td.barcell{position:relative;width:110px;text-align:right;color:#41506A}
td.barcell span{position:absolute;left:0;top:50%;transform:translateY(-50%);height:9px;border-radius:3px;
  background:linear-gradient(90deg,#BFD6F2,#0A4C95);opacity:.30}
.chart .legend{font-size:11px;color:#5B6B82;margin-bottom:6px}
.legend b{display:inline-block;width:9px;height:9px;border-radius:2px;margin:0 5px 0 10px;vertical-align:middle}
.bars{display:flex;align-items:flex-end;gap:8px;height:190px;padding:6px 2px 0}
.gbar{flex:1;display:flex;flex-direction:column;justify-content:flex-end;height:100%;text-align:center}
.stack{display:flex;gap:2px;align-items:flex-end;height:100%;justify-content:center}
.stack i{width:11px;border-radius:2px 2px 0 0;display:block}
.gbar span{font-size:10px;color:#7A889C;margin-top:5px}
.foot{margin-top:18px;font-size:11px;color:#8A97A8;display:flex;justify-content:space-between;gap:12px}
.foot a{color:#0A4C95}
.pill{background:#EAF1FA;color:#0A4C95;border-radius:20px;padding:2px 10px;font-size:10.5px;font-weight:700;
  letter-spacing:.4px;text-transform:uppercase}
@media (max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.grid2,.grid2a,.grid3{grid-template-columns:1fr}}
@media print{body{background:#fff}.card,.top{box-shadow:none}@page{size:A4;margin:10mm}}
"""

HTML = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMAM Automart — Dealer Dashboard</title>
<meta name="description" content="SMAM Automart Pvt Ltd dealership performance dashboard — sales, billing, off-take, registrations and market share.">
<style>{CSS}</style></head><body><div class="wrap">

<div class="top">
  <div>
    <div class="brand">SMAM Automart Pvt Ltd &nbsp;·&nbsp; Jammu &amp; Kashmir</div>
    <h1>Dealership Performance Dashboard</h1>
    <div class="sub">Period Jan–{ACTIVE[-1] if ACTIVE else 'Dec'} {CY} vs same months {LY} &nbsp;·&nbsp;
      history {M['years'][0]}–{CY} &nbsp;·&nbsp; one section per report</div>
  </div>
  <div class="stamp"><b>{M['generated']}</b>auto-refreshed from the Google Sheet</div>
</div>

<div class="kpis">{kpi_html()}</div>

<div class="grid2a">
  <div class="card chartcard">
    <h2><i></i>01 · BOTH DATA — sales engine</h2>
    <p class="hint">Retail, wholesale and VAHAN registrations by month. {CY} is year-to-date.</p>
    {monthly_chart()}
  </div>
  <div class="card">
    <h2><i></i>Monthly detail</h2>
    <p class="hint">Against the same months last year.</p>
    {monthly_table()}
  </div>
</div>

<div class="grid2">
  <div class="card">
    <h2><i></i>Model performance — {CY} retail</h2>
    <p class="hint">Parent product line, share of the {ret_cy} retail units this year.</p>
    {model_table()}
  </div>
  <div class="card">
    <h2><i></i>02 · PERFORMANCE — month × year</h2>
    <p class="hint">The matrix exactly as it sits on the Perfromance tab.</p>
    {matrix_table()}
  </div>
</div>

<div class="grid3">
  <div class="card">
    <h2><i></i>03 · Billing — financiers</h2>
    <p class="hint">{M['billing_rows']:,} invoices · margin {inr(M['margin_all'])} lifetime.</p>
    {bars_table(list(M['fin_all'].items()), top=10)}
  </div>
  <div class="card">
    <h2><i></i>Billing — consultants</h2>
    <p class="hint">Invoices raised in {CY}.</p>
    {bars_table(list(M['sp_cy'].items()), top=10)}
  </div>
  <div class="card">
    <h2><i></i>Billing — top districts</h2>
    <p class="hint">Customer city, {CY} · cash discount {inr(M['cash_disc'])}.</p>
    {bars_table(list(M['district_cy'].items()), top=8)}
  </div>
</div>

<div class="grid3">
  <div class="card">
    <h2><i></i>04 · Off-take by month</h2>
    <p class="hint">TM invoice date, {CY} vs {LY}.</p>
    {off_take_table()}
  </div>
  <div class="card">
    <h2><i></i>Off-take — physical status</h2>
    <p class="hint">{M['offtake_rows']:,} records · {M['vahan_ok']:,} VAHAN uploads OK.</p>
    {bars_table(list(M['phys'].items()), top=8)}
  </div>
  <div class="card">
    <h2><i></i>Off-take — stock ageing</h2>
    <p class="hint">Chassis age in days.</p>
    {bars_table(list(M['age'].items()), top=8)}
  </div>
</div>

<div class="grid2">
  <div class="card">
    <h2><i></i>05 · SMAM RTO SHEET — registration desk</h2>
    <p class="hint">Approved / pending per office, fees and MV tax collected.</p>
    {office_table()}
  </div>
  <div class="card">
    <h2><i></i>06 · JAMMU DIVISION RTO — market share</h2>
    <p class="hint">Industry vs TATA vs our registrations, by year.</p>
    {market_table()}
  </div>
</div>

<div class="grid2">
  <div class="card">
    <h2><i></i>RTO / ARTO share — {CY}</h2>
    <p class="hint">Where our volume comes from and what share of TATA we hold there.</p>
    {rto_table()}
  </div>
  <div class="card">
    <h2><i></i>07 · SRINAGAR DIVISION RTO</h2>
    <p class="hint">{CY}: industry {M['sr_ind']:,.0f} · TATA {M['sr_tat']:,.0f}
      ({pct(M['sr_tat']/M['sr_ind']*100 if M['sr_ind'] else None)}) · our valley registrations
      {n(M.get('valley', 0))}.</p>
    {bars_table(list(M['sr_rto'].items()), top=10)}
  </div>
</div>

<div class="grid2">
  <div class="card">
    <h2><i></i>08 · TATA REST DEALER AND SMAM COUNT</h2>
    <p class="hint">Our share of TATA's own registrations, year by year.</p>
    {tatarest_table()}
  </div>
  <div class="card">
    <h2><i></i>09 · RTO SHEET DEALER CA WISE</h2>
    <p class="hint">Registrations handled per consultant in {CY}.</p>
    {bars_table(list(M['ca_reg_cy'].items()), top=10)}
  </div>
</div>

<div class="grid2">
  <div class="card">
    <h2><i></i>10 · BILLING SHEET DEALER CA WISE</h2>
    <p class="hint">Invoices per consultant in {CY}.</p>
    {bars_table(list(M['ca_bill_cy'].items()), top=10)}
  </div>
  <div class="card">
    <h2><i></i>Outlets</h2>
    <p class="hint">Registrations by outlet, all time.</p>
    {bars_table(list(M['ca_outlet'].items()), top=8)}
  </div>
</div>

<div class="foot">
  <span>SMAM Automart Pvt Ltd · built from the dealer Google Sheet ·
    <a href="https://docs.google.com/spreadsheets/d/15JZOzlxUKAStJpVLxFwRnbLMsHsV1f5B5_NeegUHVxA/edit" target="_blank" rel="noopener">source workbook</a></span>
  <span class="pill">updated {M['generated']}</span>
</div>
</div></body></html>"""

(HERE / "index.html").write_text(HTML, encoding="utf-8")
print("wrote index.html", len(HTML), "bytes")
