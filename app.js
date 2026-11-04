/* SMAM Automart — dealer dashboard.
 * Reads the dealer Google Sheet directly in the browser (it is link-shared),
 * computes every figure and renders the page. No build step, no workflow, no
 * server: reload the page and it re-reads the sheet.
 */
const SHEET_ID = "15JZOzlxUKAStJpVLxFwRnbLMsHsV1f5B5_NeegUHVxA";

const TABS = {
  both:     "1083590020",
  billing:  "1144355488",
  offtake:  "1536373224",
  smam:     "402409727",
  jammu:    "1194097827",
  srinagar: "782469727",
  tatarest: "1250415802",
  rtoCa:    "1456155471",
  billCa:   "353226043"
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const VALLEY = ["SRINAGAR","ANANTNAG","BARAMULLA","BUDGAM","PULWAMA",
                "KUPWARA","GANDERBAL","BANDIPORA","KULGAM","SHOPIAN"];

/* ------------------------------------------------------------------ helpers */
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const s = v => (v == null ? "" : String(v).trim());

function num(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number") return v;
  const t = String(v).replace(/₹/g, "").replace(/Rs\.?/gi, "").replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/* dates arrive as 26-04-2019, 26-04-19, 31-Aug-26, 2019-04-26, or with a time */
function dt(v) {
  const t = s(v);
  if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})/);
  if (m) {
    const mi = MONTHS.findIndex(x => m[2].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: mi + 1, d: +m[1] }; }
  }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: +m[2], d: +m[1] }; }
  return null;
}

const fmt = (x, d = 0) =>
  x == null || x === "" || !isFinite(x) ? "–" : Number(x).toLocaleString("en-IN", { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (x, d = 1) => (x == null || !isFinite(x) ? "–" : Number(x).toFixed(d) + "%");
const inr = x => {
  if (!x) return "₹0";
  if (x >= 1e7) return "₹" + (x / 1e7).toFixed(2) + " Cr";
  if (x >= 1e5) return "₹" + (x / 1e5).toFixed(2) + " L";
  return "₹" + Math.round(x).toLocaleString("en-IN");
};
const growth = (a, b) => (!a || !b ? null : (a - b) / b);

/* ------------------------------------------------------------------ compute */
function compute(T) {
  const rows = k => (T[k] || []).slice(1).filter(r => r.some(x => s(x) !== ""));

  const offtakeRaw = rows("offtake");
  const billingRaw = rows("billing");

  /* chassis -> model lookup, because VAHAN rows arrive without a product line */
  const modelMap = {};
  for (const r of offtakeRaw) { const c = s(r[1]), m = s(r[3]); if (c && m && !modelMap[c]) modelMap[c] = m; }
  for (const r of billingRaw) { const c = s(r[3]), m = s(r[5]); if (c && m && !modelMap[c]) modelMap[c] = m; }

  /* sales core */
  const both = rows("both");
  const monthly = { RETAIL: {}, WHOLESALE: {}, VAHAN: {} };
  const years = new Set();
  for (const r of both) {
    const st = s(r[4]).toUpperCase();
    if (!["RETAIL", "WHOLESALE", "VAHAN"].includes(st)) continue;
    const d = dt(r[0]);
    let y = num(r[6]) || (d ? d.y : null);
    if (!y) continue;
    y = Math.round(y);
    let mi = MONTHS.indexOf(s(r[5]).slice(0, 3));
    if (mi < 0 && d) mi = d.m - 1;
    if (mi < 0) continue;
    years.add(y);
    (monthly[st][y] ||= new Array(12).fill(0))[mi] += 1;
  }
  const YS = [...years].sort((a, b) => a - b);
  const CY = YS[YS.length - 1], LY = YS.length > 1 ? YS[YS.length - 2] : CY - 1;
  for (const st of Object.keys(monthly)) for (const y of [CY, LY])
    monthly[st][y] ||= new Array(12).fill(0);

  const active = [];
  for (let i = 0; i < 12; i++)
    if ((monthly.RETAIL[CY][i] || 0) + (monthly.WHOLESALE[CY][i] || 0) + (monthly.VAHAN[CY][i] || 0) > 0)
      active.push(i);
  if (!active.length) active.push(0);
  const ytd = (st, y) => active.reduce((a, i) => a + (monthly[st][y][i] || 0), 0);

  /* models */
  const mCy = {}, mLy = {};
  for (const r of both) {
    const st = s(r[4]).toUpperCase();
    if (st !== "RETAIL") continue;
    const y = Math.round(num(r[6]) || (dt(r[0]) || {}).y || 0);
    const model = s(r[2]) || modelMap[s(r[1])] || "Unmapped";
    if (y === CY) mCy[model] = (mCy[model] || 0) + 1;
    if (y === LY) mLy[model] = (mLy[model] || 0) + 1;
  }
  const unmapped = mCy["Unmapped"] || 0;
  const models = Object.entries(mCy).filter(([k]) => k !== "Unmapped")
    .sort((a, b) => b[1] - a[1]);

  /* billing */
  const billing = billingRaw;
  const fin = {}, spCy = {}, distCy = {};
  let marginCy = 0, marginAll = 0, billRows = 0, billRowsCy = 0;
  for (const r of billing) {
    if (!s(r[1]) && !s(r[0])) continue;
    billRows++;
    const finKey = s(r[8]).toUpperCase() || "Not recorded";
    fin[finKey] = (fin[finKey] || 0) + 1;
    const m = num(r[20]) || 0;
    marginAll += m;
    const d = dt(r[0]);
    if (d && d.y === CY) {
      const sp = s(r[10]).toUpperCase() || "Not recorded";
      spCy[sp] = (spCy[sp] || 0) + 1;
      const dist = (s(r[16]).split(",")[0] || "").trim().toUpperCase() || "Not recorded";
      distCy[dist] = (distCy[dist] || 0) + 1;
      marginCy += m;
      billRowsCy++;
    }
  }

  /* off-take */
  const offtake = offtakeRaw;
  const otm = { [CY]: new Array(12).fill(0), [LY]: new Array(12).fill(0) };
  const phys = {}, age = { "0-30 days": 0, "31-60 days": 0, "61-90 days": 0, "91-180 days": 0, "180+ days": 0 };
  let vahanOk = 0;
  for (const r of offtake) {
    const d = dt(r[0]);
    if (!d) continue;
    if (otm[d.y]) otm[d.y][d.m - 1] += 1;
    const p = s(r[7]) || "Not recorded";
    phys[p] = (phys[p] || 0) + 1;
    const a = num(r[17]);
    if (a != null) {
      if (a <= 30) age["0-30 days"]++;
      else if (a <= 60) age["31-60 days"]++;
      else if (a <= 90) age["61-90 days"]++;
      else if (a <= 180) age["91-180 days"]++;
      else age["180+ days"]++;
    }
    if (s(r[20]).toUpperCase() === "SUCCESS") vahanOk++;
  }

  /* SMAM registrations */
  const smam = rows("smam");
  const offices = {}, statusSplit = { APPROVED: 0, PENDING: 0, OTHER: 0 }, smamYear = {};
  let valley = 0;
  for (const r of smam) {
    const d = dt(r[5]);
    if (!d) continue;
    smamYear[d.y] = (smamYear[d.y] || 0) + 1;
    const office = s(r[1]) || "Unknown";
    const st = s(r[19]).toUpperCase();
    const o = offices[office] ||= { reg: 0, approved: 0, pending: 0, fees: 0, tax: 0 };
    o.reg++;
    if (st === "APPROVED") { o.approved++; statusSplit.APPROVED++; }
    else if (st === "PENDING AT APPROVE") { o.pending++; statusSplit.PENDING++; }
    else statusSplit.OTHER++;
    o.fees += num(r[23]) || 0;
    o.tax += num(r[24]) || 0;
    if (d.y === CY && VALLEY.some(v => office.toUpperCase().includes(v))) valley++;
  }
  const officeRows = Object.entries(offices).sort((a, b) => b[1].reg - a[1].reg).slice(0, 12);

  /* market */
  const jammu = rows("jammu");
  const indYear = {}, tataYear = {}, rtoInd = {}, rtoTata = {};
  for (const r of jammu) {
    const y = Math.round(num(r[5]) || 0), c = num(r[4]) || 0;
    if (!y || !c) continue;
    indYear[y] = (indYear[y] || 0) + c;
    const isTata = s(r[0]).toUpperCase().startsWith("TATA");
    if (isTata) tataYear[y] = (tataYear[y] || 0) + c;
    if (y === CY) {
      const rto = s(r[1]).toUpperCase();
      rtoInd[rto] = (rtoInd[rto] || 0) + c;
      if (isTata) rtoTata[rto] = (rtoTata[rto] || 0) + c;
    }
  }
  const rtoSmam = {};
  for (const r of smam) {
    const d = dt(r[5]);
    if (!d || d.y !== CY) continue;
    const key = s(r[1]).toUpperCase().replace(/\(\s*JK\s*-?\s*\d*\s*\)/g, "")
      .replace(/\s+(ARTO|RTO)\s*$/, "").replace(/\b(ARTO|RTO)\b/g, "").trim();
    if (key) rtoSmam[key] = (rtoSmam[key] || 0) + 1;
  }
  const rtoKeys = new Set([...Object.keys(rtoInd), ...Object.keys(rtoTata)]);
  const rtoRows = [...rtoKeys].map(k => {
    const ind = rtoInd[k] || 0, tat = rtoTata[k] || 0, own = rtoSmam[k] || 0;
    return { rto: k, industry: ind, tata: tat, smam: own,
             tataShare: ind ? tat / ind * 100 : null,
             smamOfTata: tat ? own / tat * 100 : null };
  }).filter(r => r.industry > 0).sort((a, b) => b.industry - a.industry).slice(0, 10);

  const market = YS.filter(y => indYear[y]).map(y => ({
    year: y, industry: indYear[y] || 0, tata: tataYear[y] || 0, smam: smamYear[y] || 0,
    tataShare: indYear[y] ? (tataYear[y] || 0) / indYear[y] * 100 : null,
    smamOfTata: tataYear[y] ? (smamYear[y] || 0) / tataYear[y] * 100 : null
  }));

  /* srinagar */
  const srin = rows("srinagar");
  let srInd = 0, srTata = 0; const srRto = {};
  for (const r of srin) {
    const c = num(r[3]) || 0;
    srInd += c;
    if (s(r[0]).toUpperCase().startsWith("TATA")) srTata += c;
    const k = s(r[1]).toUpperCase();
    srRto[k] = (srRto[k] || 0) + c;
  }
  const srRtoRows = Object.entries(srRto).sort((a, b) => b[1] - a[1]).slice(0, 10);

  /* tata rest dealer */
  const tr = rows("tatarest");
  const trMap = {};
  for (const r of tr) {
    const y = Math.round(num(r[4]) || 0);
    const c = num(r[3]) || 0;
    const st = s(r[5]).toUpperCase();
    if (!y) continue;
    const o = trMap[y] ||= { year: y, smam: 0, overall: 0 };
    if (st === "SMAM COUNT") o.smam += c;
    else if (st === "OVER ALL COUNT") o.overall += c;
  }
  const tatarest = Object.values(trMap).sort((a, b) => a.year - b.year)
    .map(o => ({ ...o, share: o.overall ? o.smam / o.overall * 100 : null }));

  /* CA tables */
  const caRegCy = {}, caOutlet = {};
  for (const r of rows("rtoCa")) {
    const outl = s(r[5]).toUpperCase() || "Not recorded";
    caOutlet[outl] = (caOutlet[outl] || 0) + 1;
    const d = dt(r[0]);
    if (!d || d.y !== CY) continue;
    const k = s(r[6]).toUpperCase() || "Not recorded";
    caRegCy[k] = (caRegCy[k] || 0) + 1;
  }
  const caBillCy = {}; let cashDisc = 0;
  for (const r of rows("billCa")) {
    cashDisc += num(r[8]) || 0;
    const d = dt(r[0]);
    if (!d || d.y !== CY) continue;
    const k = s(r[7]).toUpperCase() || "Not recorded";
    caBillCy[k] = (caBillCy[k] || 0) + 1;
  }

  return {
    cy: CY, ly: LY, years: YS, months: MONTHS, active, monthly,
    ytd: {
      retail: ytd("RETAIL", CY), retailLy: ytd("RETAIL", LY),
      whole: ytd("WHOLESALE", CY), wholeLy: ytd("WHOLESALE", LY),
      vahan: ytd("VAHAN", CY), vahanLy: ytd("VAHAN", LY)
    },
    models, modelLy: mLy, unmapped,
    fin: Object.entries(fin).sort((a, b) => b[1] - a[1]).slice(0, 10),
    sp: Object.entries(spCy).sort((a, b) => b[1] - a[1]).slice(0, 10),
    dist: Object.entries(distCy).sort((a, b) => b[1] - a[1]).slice(0, 8),
    billRows, marginCy, marginAll, billRowsCy, avgMargin: billRowsCy ? marginCy / billRowsCy : 0,
    offtake: otm, phys: Object.entries(phys).sort((a, b) => b[1] - a[1]),
    age: Object.entries(age), vahanOk, offtakeRows: offtake.length,
    offices: officeRows, statusSplit, valley, smamYear,
    market, rto: rtoRows, srInd, srTata, srRto: srRtoRows,
    tatarest, caReg: Object.entries(caRegCy).sort((a, b) => b[1] - a[1]).slice(0, 10),
    caBill: Object.entries(caBillCy).sort((a, b) => b[1] - a[1]).slice(0, 10),
    caOutlet: Object.entries(caOutlet).sort((a, b) => b[1] - a[1]).slice(0, 8),
    cashDisc,
    generated: new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  };
}

/* ------------------------------------------------------------------- render */
const el = (tag, cls, html) => {
  const d = document.createElement(tag);
  if (cls) d.className = cls;
  if (html != null) d.innerHTML = html;
  return d;
};

function table(headers, rows, opts = {}) {
  const t = el("table", "grid" + (opts.compact ? " compact" : ""));
  t.innerHTML = "<thead><tr>" + headers.map(h => {
    const cls = h && h.cls ? h.cls : "";
    const v = h && h.v !== undefined ? h.v : h;
    return `<th class="${cls}">${v}</th>`;
  }).join("") + "</tr></thead><tbody>" +
    rows.join("") + "</tbody>";
  return t;
}

const rowHtml = (cells) => "<tr>" + cells.map(c => {
  if (typeof c === "object" && c !== null) return `<td class="${c.cls || ""}">${c.v}</td>`;
  return `<td>${c}</td>`;
}).join("") + "</tr>";

const barRow = (label, value, max, suffix = "") =>
  `<tr><td class="l">${label}</td><td class="num">${fmt(value)}${suffix}</td>` +
  `<td class="barcell"><span style="width:${Math.max(2, value / max * 100)}%"></span></td></tr>`;

function barsTable(pairs) {
  const max = Math.max(...pairs.map(p => p[1]), 1);
  const t = el("table", "grid compact");
  t.innerHTML = "<tbody>" + pairs.map(([k, v]) =>
    barRow(k.length && k === k.toUpperCase() ? k.charAt(0) + k.slice(1).toLowerCase() : k, v, max)).join("") + "</tbody>";
  return t;
}

function kpiCard(label, value, delta, sub, color) {
  const d = el("div", "kpi");
  d.style.setProperty("--c", color);
  const chip = delta == null || !isFinite(delta) || Math.abs(delta) > 5
    ? "" : `<span class="chip ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(1)}%</span>`;
  d.innerHTML = `<div class="k-label">${label}</div><div class="k-value">${value}</div>` +
    `<div class="k-foot">${chip}<span class="k-sub">${sub}</span></div>`;
  return d;
}

function card(title, hint, node) {
  const c = el("div", "card");
  c.appendChild(el("h2", null, `<i></i>${title}`));
  if (hint) c.appendChild(el("p", "hint", hint));
  c.appendChild(node);
  return c;
}

function monthlyChart(M) {
  const R = M.monthly.RETAIL[M.cy], W = M.monthly.WHOLESALE[M.cy], V = M.monthly.VAHAN[M.cy];
  const max = Math.max(...R, ...W, ...V, 1);
  const wrap = el("div", "chart");
  wrap.innerHTML = `<div class="legend"><b style="background:#0A4C95"></b>Retail ` +
    `<b style="background:#128C7E"></b>Wholesale <b style="background:#8E7CC3"></b>VAHAN</div>` +
    `<div class="bars">` + MONTHS.map((m, i) =>
      `<div class="gbar"><div class="stack">` +
      `<i style="height:${R[i] / max * 100}%;background:#0A4C95"></i>` +
      `<i style="height:${W[i] / max * 100}%;background:#128C7E"></i>` +
      `<i style="height:${V[i] / max * 100}%;background:#8E7CC3"></i>` +
      `</div><span>${m}</span></div>`).join("") + `</div>`;
  return wrap;
}

function render(M) {
  const root = document.getElementById("app");
  root.innerHTML = "";
  const CY = M.cy, LY = M.ly;
  const mktCy = M.market.find(m => m.year === CY) || {};
  const mktLy = M.market.find(m => m.year === LY) || {};

  /* header */
  const top = el("div", "top");
  top.innerHTML = `
    <div><div class="brand">SMAM Automart Pvt Ltd &nbsp;·&nbsp; Jammu &amp; Kashmir</div>
      <h1>Dealership Performance Dashboard</h1>
      <div class="sub">Period Jan–${M.months[M.active[M.active.length - 1]]} ${CY} vs same months ${LY}
        &nbsp;·&nbsp; history ${M.years[0]}–${CY} &nbsp;·&nbsp; one section per report</div></div>
    <div class="stamp"><b>${M.generated}</b>read live from the Google Sheet</div>`;
  root.appendChild(top);

  /* KPIs */
  const kpis = el("div", "kpis");
  [
    ["Retail · YTD", fmt(M.ytd.retail), growth(M.ytd.retail, M.ytd.retailLy), "units delivered", "#0A4C95"],
    ["Wholesale · YTD", fmt(M.ytd.whole), growth(M.ytd.whole, M.ytd.wholeLy), "units billed", "#128C7E"],
    ["VAHAN · YTD", fmt(M.ytd.vahan), growth(M.ytd.vahan, M.ytd.vahanLy), "registrations", "#6C4AB6"],
    ["Off-take · YTD", fmt(M.active.reduce((a, i) => a + M.offtake[CY][i], 0)),
      growth(M.active.reduce((a, i) => a + M.offtake[CY][i], 0), M.active.reduce((a, i) => a + M.offtake[LY][i], 0)),
      "TM invoices", "#E07B00"],
    ["TATA share · Jammu div.", mktCy.tataShare == null ? "–" : mktCy.tataShare.toFixed(2) + "%",
      growth(mktCy.tataShare, mktLy.tataShare), "of industry PV", "#0A4C95"],
    ["SMA share of TATA", mktCy.smamOfTata == null ? "–" : mktCy.smamOfTata.toFixed(1) + "%",
      growth(mktCy.smamOfTata, mktLy.smamOfTata), "our slice of TATA", "#C0392B"],
    ["Dealer margin · YTD", inr(M.marginCy), null, `avg ${inr(M.avgMargin)}/unit`, "#1E8E5A"],
    ["Pending registrations", fmt(M.statusSplit.PENDING), null, "waiting at RTO/ARTO", "#5B6B82"]
  ].forEach(([l, v, d, sub, c]) => kpis.appendChild(kpiCard(l, v, d, sub, c)));
  root.appendChild(kpis);

  /* 01 + monthly */
  const g1 = el("div", "grid2a");
  g1.appendChild(card("01 · BOTH DATA — sales engine",
    `Retail, wholesale and VAHAN by month. ${CY} is year-to-date.`, monthlyChart(M)));
  const mt = el("div");
  mt.appendChild(table(
    ["Month", `Retail ${CY}`, `Wholesale ${CY}`, `VAHAN ${CY}`, { v: `Retail ${LY}`, cls: "dim" }, "Growth"],
    M.months.map((m, i) => {
      const has = M.active.includes(i);
      const g = growth(M.monthly.RETAIL[CY][i], M.monthly.RETAIL[LY][i]);
      return rowHtml([m, has ? M.monthly.RETAIL[CY][i] : "–", has ? M.monthly.WHOLESALE[CY][i] : "–",
        has ? M.monthly.VAHAN[CY][i] : "–", { v: has ? M.monthly.RETAIL[LY][i] : "–", cls: "dim" },
        { v: g == null ? "–" : (g * 100).toFixed(1) + "%", cls: g >= 0 ? "pos" : "neg" }]);
    }).concat([`<tr class="tot"><td class="l">TOTAL</td><td>${M.ytd.retail}</td><td>${M.ytd.whole}</td>` +
      `<td>${M.ytd.vahan}</td><td>${M.ytd.retailLy}</td><td class="${growth(M.ytd.retail, M.ytd.retailLy) >= 0 ? "pos" : "neg"}">` +
      `${(growth(M.ytd.retail, M.ytd.retailLy) * 100).toFixed(1)}%</td></tr>`])
  ));
  g1.appendChild(card("Monthly detail", "Against the same months last year.", mt));
  root.appendChild(g1);

  /* model + matrix */
  const g2 = el("div", "grid2");
  const modelT = el("div");
  modelT.appendChild(table(["Model", `Retail ${CY}`, { v: `Retail ${LY}`, cls: "dim" }, "Growth", "Share"],
    M.models.slice(0, 10).map(([name, v]) => {
      const ly = M.modelLy[name] || 0, g = growth(v, ly);
      return rowHtml([name, v, { v: ly || "–", cls: "dim" },
        { v: g == null ? "new" : (g * 100).toFixed(1) + "%", cls: g == null || g >= 0 ? "pos" : "neg" },
        (v / M.ytd.retail * 100).toFixed(1) + "%"]);
    })));
  g2.appendChild(card(`Model performance — ${CY} retail`,
    `Share of the ${M.ytd.retail} retail units this year` +
    (M.unmapped ? ` · ${M.unmapped} rows carry no model in BOTH DATA` : "") + ".", modelT));

  const matrixT = el("div");
  matrixT.appendChild(table(["Month", `${LY} R`, `${LY} W`, `${LY} V`, `${CY} R`, `${CY} W`, `${CY} V`, "Δ"],
    M.months.map((m, i) => {
      const g = growth(M.monthly.RETAIL[CY][i], M.monthly.RETAIL[LY][i]);
      return rowHtml([m, M.monthly.RETAIL[LY][i] || "–", M.monthly.WHOLESALE[LY][i] || "–", M.monthly.VAHAN[LY][i] || "–",
        M.monthly.RETAIL[CY][i] || "–", M.monthly.WHOLESALE[CY][i] || "–", M.monthly.VAHAN[CY][i] || "–",
        { v: g == null ? "–" : (g * 100).toFixed(1) + "%", cls: g >= 0 ? "pos" : "neg" }]);
    })));
  g2.appendChild(card("02 · PERFORMANCE — month × year", "As it sits on the Perfromance tab.", matrixT));
  root.appendChild(g2);

  /* billing trio */
  const g3 = el("div", "grid3");
  g3.appendChild(card("03 · Billing — financiers",
    `${fmt(M.billRows)} invoices · margin ${inr(M.marginAll)} lifetime.`, barsTable(M.fin)));
  g3.appendChild(card("Billing — consultants", `Invoices raised in ${CY}.`, barsTable(M.sp)));
  g3.appendChild(card("Billing — top districts", `Customer city, ${CY} · cash discount ${inr(M.cashDisc)}.`, barsTable(M.dist)));
  root.appendChild(g3);

  /* off-take trio */
  const g4 = el("div", "grid3");
  const otT = el("div");
  otT.appendChild(table(["Month", `${CY}`, { v: `${LY}`, cls: "dim" }, "Growth"],
    M.months.map((m, i) => {
      const has = M.active.includes(i), g = growth(M.offtake[CY][i], M.offtake[LY][i]);
      return rowHtml([m, has ? M.offtake[CY][i] : "–", { v: has ? M.offtake[LY][i] : "–", cls: "dim" },
        { v: g == null ? "–" : (g * 100).toFixed(1) + "%", cls: g >= 0 ? "pos" : "neg" }]);
    })));
  g4.appendChild(card("04 · Off-take by month", `TM invoice date, ${CY} vs ${LY}.`, otT));
  g4.appendChild(card("Off-take — physical status",
    `${fmt(M.offtakeRows)} records · ${fmt(M.vahanOk)} VAHAN uploads OK.`, barsTable(M.phys)));
  g4.appendChild(card("Off-take — stock ageing", "Chassis age in days.", barsTable(M.age)));
  root.appendChild(g4);

  /* RTO + market */
  const g5 = el("div", "grid2");
  const ofT = el("div");
  ofT.appendChild(table(["Office", "Regs", "Approved", "Pending", "Fees", "MV tax"],
    M.offices.map(([name, v]) => rowHtml([name, v.reg, v.approved,
      { v: v.pending, cls: v.pending ? "warn" : "" }, inr(v.fees), inr(v.tax)]))));
  g5.appendChild(card("05 · SMAM RTO SHEET — registration desk",
    "Approved / pending per office, fees and MV tax collected.", ofT));

  const mkT = el("div");
  mkT.appendChild(table(["Year", "Industry", "TATA", "SMA", "TATA share", "SMA of TATA"],
    M.market.map(r => rowHtml([r.year, fmt(r.industry), fmt(r.tata), fmt(r.smam),
      { v: pct(r.tataShare), cls: "" },
      { v: pct(r.smamOfTata), cls: (r.smamOfTata || 0) >= 35 ? "pos" : "" }]))));
  g5.appendChild(card("06 · JAMMU DIVISION RTO — market share",
    "Industry vs TATA vs our registrations, by year.", mkT));
  root.appendChild(g5);

  const g6 = el("div", "grid2");
  const rtoT = el("div");
  rtoT.appendChild(table(["RTO / ARTO", "Industry", "TATA", "SMA", "TATA share", "SMA of TATA"],
    M.rto.map(r => rowHtml([r.rto, fmt(r.industry), fmt(r.tata), fmt(r.smam), pct(r.tataShare),
      { v: pct(r.smamOfTata), cls: "barcell" }]))));
  g6.appendChild(card(`RTO / ARTO share — ${CY}`, "Where our volume comes from.", rtoT));
  g6.appendChild(card("07 · SRINAGAR DIVISION RTO",
    `${CY}: industry ${fmt(M.srInd)} · TATA ${fmt(M.srTata)} ` +
    `(${M.srInd ? (M.srTata / M.srInd * 100).toFixed(1) : "–"}%) · our valley registrations ${M.valley}.`,
    barsTable(M.srRto)));
  root.appendChild(g6);

  const g7 = el("div", "grid2");
  const trT = el("div");
  trT.appendChild(table(["Year", "SMAM count", "Overall TATA", "Our share"],
    M.tatarest.map(r => rowHtml([r.year, fmt(r.smam), fmt(r.overall), pct(r.share)]))));
  g7.appendChild(card("08 · TATA REST DEALER AND SMAM COUNT",
    "Our share of TATA's own registrations.", trT));
  g7.appendChild(card("09 · RTO SHEET DEALER CA WISE",
    `Registrations handled per consultant in ${CY}.`, barsTable(M.caReg)));
  root.appendChild(g7);

  const g8 = el("div", "grid2");
  g8.appendChild(card("10 · BILLING SHEET DEALER CA WISE",
    `Invoices per consultant in ${CY} · cash discount ${inr(M.cashDisc)} given.`, barsTable(M.caBill)));
  const outletCard = card("Registrations by outlet",
    "Where our registrations are handled, all time.", barsTable(M.caOutlet));
  g8.appendChild(outletCard);
  root.appendChild(g8);

  const foot = el("div", "foot");
  foot.innerHTML = `<span>SMAM Automart Pvt Ltd · read live from the
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener">dealer Google Sheet</a></span>
    <span class="pill">updated ${M.generated}</span>`;
  root.appendChild(foot);
}

/* --------------------------------------------------------------------- boot */
async function loadTab(gid) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`tab ${gid}: HTTP ${res.status}`);
  return parseCsv(await res.text());
}

async function boot() {
  const root = document.getElementById("app");
  root.innerHTML = `<div class="loading">Reading the Google Sheet…</div>`;
  try {
    const tabs = {};
    await Promise.all(Object.entries(TABS).map(async ([k, gid]) => {
      tabs[k] = await loadTab(gid);
    }));
    render(compute(tabs));
  } catch (err) {
    root.innerHTML = `<div class="error"><b>Could not read the sheet.</b><br>${err.message}<br><br>
      The workbook must stay shared as <i>anyone with the link → viewer</i>.</div>`;
  }
}

if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { compute, parseCsv, dt, num };
