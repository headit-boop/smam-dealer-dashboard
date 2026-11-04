/* SMAM Automart — dealer dashboard.
 * One report per tab (dropdown), with year / month filters, plus an outlet
 * filter for the two dealer-CA tabs. Data is read live from the Google Sheet.
 */
const BUILD = "04 Nov 2026 12:11";
const SHEET_ID = "15JZOzlxUKAStJpVLxFwRnbLMsHsV1f5B5_NeegUHVxA";

const TABS = {
  both:     { gid: "1083590020", name: "BOTH DATA", annual: false },
  perf:     { gid: "744351213",  name: "Perfromance", annual: false },
  billing:  { gid: "1144355488", name: "BILLING REGISTER MIS", annual: false },
  offtake:  { gid: "1536373224", name: "OFF TAKE REPORT MIS", annual: false },
  smam:     { gid: "402409727",  name: "SMAM RTO SHEET", annual: false },
  jammu:    { gid: "1194097827", name: "JAMMU DIVISION RTO SHEET", annual: false },
  srinagar: { gid: "782469727",  name: "SRINAGAR DIVISION RTO SHEET", annual: false },
  tatarest: { gid: "1250415802", name: "TATA MOTORS REST DEALER AND SMAM COUNT", annual: false },
  rtoca:    { gid: "1456155471", name: "RTO SHEET DEALER CA WISE", annual: false, outlet: true },
  rtocaavg: { gid: "1456155471", name: "RTO CA — OUTLET & CA PERFORMANCE (3M / 6M / 12M)", annual: false, outlet: true, period: true },
  billca:   { gid: "353226043",  name: "BILLING SHEET DEALER CA WISE", annual: false, outlet: true }
};
const ORDER = ["both", "perf", "billing", "offtake", "smam", "jammu", "srinagar", "tatarest", "rtoca", "rtocaavg", "billca"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const VALLEY = ["SRINAGAR","ANANTNAG","BARAMULLA","BUDGAM","PULWAMA",
                "KUPWARA","GANDERBAL","BANDIPORA","KULGAM","SHOPIAN"];

/* ------------------------------------------------------------------ helpers */
function parseCsv(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
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
  if (!t) return null;
  const n = Number(t); return isFinite(n) ? n : null;
}
function dt(v) {
  const t = s(v); if (!t) return null;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) { const y = +m[1]; return (y < 1990 || y > 2100) ? null : { y, m: +m[2], d: +m[3] }; }
  m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})/);
  if (m) {
    const mi = MONTHS.findIndex(x => m[2].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: mi + 1, d: +m[1] }; }
  }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let y = +m[3]; if (y < 100) y += 2000;
    if (y < 1990 || y > 2100) return null;
    return { y, m: +m[2], d: +m[1] };
  }
  return null;
}
const monthIdx = v => {
  const t = s(v).slice(0, 3).toLowerCase();
  const i = MONTHS.findIndex(x => x.toLowerCase() === t);
  return i >= 0 ? i + 1 : 0;
};
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
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const topN = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
const sum = (o = {}) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const sum12 = a => (a || []).reduce((x, y) => x + (y || 0), 0);
const titleCase = t => String(t).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const cleanRto = v => s(v).toUpperCase()
  .replace(/\(\s*JK\s*-?\s*\d*\s*\)/g, "")
  .replace(/\s+(ARTO|RTO)\s*$/, "")
  .replace(/\b(ARTO|RTO)\b/g, "")
  .replace(/-/g, " ").replace(/\s+/g, " ").trim();

/* -------------------------------------------------------------------- index */
function buildIndex(T) {
  const rows = k => (T[k] || []).slice(1).filter(r => r.some(x => s(x) !== ""));

  const offtakeRaw = rows("offtake");
  const billingRaw = rows("billing");
  const modelMap = {};
  for (const r of offtakeRaw) { const c = s(r[1]), m = s(r[3]); if (c && m && !modelMap[c]) modelMap[c] = m; }
  for (const r of billingRaw) { const c = s(r[3]), m = s(r[5]); if (c && m && !modelMap[c]) modelMap[c] = m; }

  /* sales + models */
  const sales = { RETAIL: {}, WHOLESALE: {}, VAHAN: {} };
  const models = {}, unmapped = {};
  for (const r of rows("both")) {
    const st = s(r[4]).toUpperCase();
    if (!sales[st]) continue;
    const d = dt(r[0]);
    const y = Math.round(num(r[6]) || (d ? d.y : 0));
    if (!y) continue;
    let mi = monthIdx(r[5]);
    if (!mi && d) mi = d.m;
    if (!mi) continue;
    (sales[st][y] ||= new Array(12).fill(0))[mi - 1] += 1;
    if (st === "RETAIL") {
      const model = s(r[2]) || modelMap[s(r[1])] || "Unmapped";
      const M = ((models[y] ||= {})[mi] ||= {});
      if (model === "Unmapped") { (unmapped[y] ||= new Array(13).fill(0))[mi] += 1; }
      else add(M, model);
    }
  }

  /* billing */
  const billing = {};
  for (const r of billingRaw) {
    if (!s(r[1]) && !s(r[0])) continue;
    const d = dt(r[0]); if (!d) continue;
    const M = (((billing[d.y] ||= {})[d.m]) ||= { count: 0, margin: 0, fin: {}, sp: {}, dist: {} });
    M.count++;
    M.margin += num(r[20]) || 0;
    add(M.fin, s(r[8]).toUpperCase() || "Not recorded");
    add(M.sp, s(r[10]).toUpperCase() || "Not recorded");
    add(M.dist, (s(r[16]).split(",")[0] || "").trim().toUpperCase() || "Not recorded");
  }

  /* off-take */
  const offtake = {}, offtakeModel = {}, ageY = {}, ageYM = {};
  for (const r of offtakeRaw) {
    const d = dt(r[0]); if (!d) continue;
    const M = (((offtake[d.y] ||= {})[d.m]) ||= { count: 0, phys: {}, vahan: 0, model: {} });
    M.count++;
    if (s(r[20]).toUpperCase() === "SUCCESS") M.vahan++;
    add(M.phys, s(r[7]) || "Not recorded");
    const model = s(r[3]) || s(r[22]) || "Unrecorded";
    add(M.model, model);
    add((offtakeModel[d.y] ||= {}), model);
    const a = num(r[17]);
    if (a != null) {
      const b = a <= 30 ? "0-30 days" : a <= 60 ? "31-60 days" : a <= 90 ? "61-90 days"
        : a <= 180 ? "91-180 days" : "180+ days";
      add((ageY[d.y] ||= {}), b);
      add((ageYM[d.y] ||= {})[d.m] ||= {}, b);
    }
  }

  /* SMAM registrations */
  const smam = {}, valley = {};
  for (const r of rows("smam")) {
    const d = dt(r[5]); if (!d) continue;
    const M = (((smam[d.y] ||= {})[d.m]) ||= { reg: 0, appr: 0, pend: 0, other: 0, fees: 0, tax: 0, office: {}, officeAppr: {} });
    M.reg++;
    const st = s(r[19]).toUpperCase();
    if (st === "APPROVED") M.appr++;
    else if (st === "PENDING AT APPROVE") M.pend++;
    else M.other++;
    M.fees += num(r[23]) || 0;
    M.tax += num(r[24]) || 0;
    const office = s(r[1]) || "Unknown";
    add(M.office, office);
    if (st === "APPROVED") add(M.officeAppr, office);
    if (VALLEY.some(v => office.toUpperCase().includes(v))) valley[d.y] = (valley[d.y] || 0) + 1;
  }

  /* jammu — now month aware */
  const jammu = {};
  for (const r of rows("jammu")) {
    const y = Math.round(num(r[5]) || 0), c = num(r[4]) || 0;
    const m = monthIdx(r[2]) || Math.round(num(r[3]) || 0);
    if (!y || !c || !m) continue;
    const M = (((jammu[y] ||= {})[m]) ||= { industry: 0, tata: 0, rto: {}, makers: {} });
    M.industry += c;
    const isTata = s(r[0]).toUpperCase().startsWith("TATA");
    if (isTata) M.tata += c;
    add(M.makers, s(r[0]).toUpperCase() || "Unknown", c);
    const rto = s(r[1]).toUpperCase();
    if (rto) { const R = (M.rto[rto] ||= { ind: 0, tata: 0 }); R.ind += c; if (isTata) R.tata += c; }
  }

  /* srinagar — month aware */
  const srin = { months: {} };
  for (const r of rows("srinagar")) {
    const c = num(r[3]) || 0;
    const m = monthIdx(r[2]) || 0;
    if (!c) continue;
    const M = ((srin.months[m]) ||= { industry: 0, tata: 0, rto: {}, makers: {} });
    M.industry += c;
    const maker = s(r[0]).toUpperCase();
    add(M.makers, maker, c);
    add(M.rto, s(r[1]).toUpperCase(), c);
    if (maker.startsWith("TATA")) M.tata += c;
  }

  /* tata rest dealer — month aware */
  const tatarest = {};
  for (const r of rows("tatarest")) {
    const c = num(r[3]) || 0;
    const d = dt(r[2]);
    const y = Math.round(num(r[4]) || (d ? d.y : 0));
    const m = d ? d.m : monthIdx(r[2]);
    const st = s(r[5]).toUpperCase();
    if (!y || !m) continue;
    const M = (((tatarest[y] ||= {})[m]) ||= { smam: 0, overall: 0, rto: {} });
    const rto = cleanRto(r[1]) || "Unknown";
    const R = (M.rto[rto] ||= { smam: 0, overall: 0 });
    if (st === "SMAM COUNT") { M.smam += c; R.smam += c; }
    else if (st === "OVER ALL COUNT") { M.overall += c; R.overall += c; }
  }

  /* dealer CA tabs (both have an OUTLET column) */
  const caReg = {}, caBill = {}, outlets = new Set();
  for (const r of rows("rtoca")) {
    const d = dt(r[0]); if (!d) continue;
    const M = (((caReg[d.y] ||= {})[d.m]) ||= { sc: {}, outlet: {}, scOut: {} });
    const out = s(r[5]).toUpperCase();
    if (!out || out === "0") continue;
    const sc = s(r[6]).toUpperCase() || "Not recorded";
    add(M.sc, sc); add(M.outlet, out); add(M.scOut, `${out}||${sc}`);
    outlets.add(out);
  }
  for (const r of rows("billca")) {
    const d = dt(r[0]); if (!d) continue;
    const M = (((caBill[d.y] ||= {})[d.m]) ||= { sc: {}, outlet: {}, scOut: {}, disc: 0, discOut: {} });
    const out = (s(r[6]).toUpperCase() || "").replace("#N/A", "NOT MAPPED");
    if (!out || out === "0") continue;
    const sc = s(r[7]).toUpperCase() || "Not recorded";
    const disc = num(r[8]) || 0;
    add(M.sc, sc); add(M.outlet, out); add(M.scOut, `${out}||${sc}`);
    M.disc += disc; add(M.discOut, out, disc);
    outlets.add(out);
  }

  function span(map) {
    const keys = [];
    for (const [yy, mm] of Object.entries(map))
      for (const [m, v] of Object.entries(mm))
        if (typeof v === "number" ? v > 0 : v && Object.keys(v).length) keys.push([Number(yy), Number(m)]);
    if (!keys.length) return null;
    keys.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return { from: keys[0], to: keys[keys.length - 1] };
  }
  const yearly = map => {
    const ys = Object.keys(map).map(Number).sort((a, b) => a - b);
    return ys.length ? { from: [ys[0], 0], to: [ys[ys.length - 1], 0] } : null;
  };
  const ranges = {
    both: span(sales.RETAIL), billing: span(billing), offtake: span(offtake),
    smam: span(smam), rtoca: span(caReg), billca: span(caBill),
    jammu: span(jammu), tatarest: span(tatarest)
  };

  const years = [...new Set([...Object.keys(sales.RETAIL), ...Object.keys(billing),
    ...Object.keys(offtake), ...Object.keys(smam), ...Object.keys(jammu),
    ...Object.keys(tatarest), ...Object.keys(caReg), ...Object.keys(caBill)].map(Number))]
    .sort((a, b) => a - b);

  return { sales, models, unmapped, billing, offtake, offtakeModel, ageY, ageYM,
           smam, jammu, srinagar: srin, tatarest, caReg, caBill, valley, years, ranges,
           outlets: [...outlets].sort() };
}

/* --------------------------------------------------------------- aggregates */
function mergeDeep(a, b) {
  for (const [k, v] of Object.entries(b || {})) {
    if (typeof v === "number") a[k] = (a[k] || 0) + v;
    else if (v && typeof v === "object") a[k] = mergeDeep(a[k] || {}, v);
  }
  return a;
}
function yearMap(map, y) {
  if (y !== "all") return map[String(y)] || {};
  const out = {};
  for (const v of Object.values(map)) mergeDeep(out, v);
  return out;
}
const monthList = (map, m) => (m === "all" ? Object.values(map) : [map[String(m)] || {}]);
const sumField = (list, f) => list.reduce((a, x) => a + (x[f] || 0), 0);
function mergeCounters(list, f) {
  const out = {};
  for (const x of list) for (const [k, v] of Object.entries(x[f] || {})) out[k] = (out[k] || 0) + v;
  return out;
}
function monthTotals(map, m) {
  return m === "all" ? Object.values(map).reduce((a, x) => mergeDeep(a, x), {}) : (map[String(m)] || {});
}

/* ------------------------------------------------------------------ render */
const el = (t, c, h) => { const d = document.createElement(t); if (c) d.className = c; if (h != null) d.innerHTML = h; return d; };
const table = (headers, rows, compact) => {
  const t = el("table", "grid" + (compact ? " compact" : ""));
  t.innerHTML = "<thead><tr>" + headers.map(h => {
    const cls = h && h.cls ? h.cls : "", v = h && h.v !== undefined ? h.v : h;
    return `<th class="${cls}">${v}</th>`;
  }).join("") + "</tr></thead><tbody>" + rows.join("") + "</tbody>";
  return t;
};
const rw = (cells, opts = {}) => `<tr${opts.cls ? ` class="${opts.cls}"` : ""}>` + cells.map(c =>
  (c && typeof c === "object") ? `<td class="${c.cls || ""}">${c.v}</td>` : `<td>${c}</td>`).join("") + "</tr>";
function barsTable(pairs, n = 12) {
  const list = pairs.slice(0, n);
  const max = Math.max(...list.map(p => p[1]), 1);
  const t = el("table", "grid compact");
  t.innerHTML = "<tbody>" + list.map(([k, v]) =>
    `<tr><td class="l">${k}</td><td class="num">${fmt(v)}</td>` +
    `<td class="barcell"><span style="width:${Math.max(2, v / max * 100)}%"></span></td></tr>`).join("") + "</tbody>";
  return t;
}
function card(title, hint, node) {
  const c = el("div", "card");
  c.appendChild(el("h2", null, `<i></i>${title}`));
  if (hint) c.appendChild(el("p", "hint", hint));
  if (node) c.appendChild(node);
  return c;
}
function kpiRow(items) {
  const w = el("div", "kpis");
  for (const [label, value, delta, sub, color] of items) {
    const d = el("div", "kpi"); d.style.setProperty("--c", color);
    const chip = delta == null || !isFinite(delta) || Math.abs(delta) > 5 ? ""
      : `<span class="chip ${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta * 100).toFixed(1)}%</span>`;
    d.innerHTML = `<div class="k-label">${label}</div><div class="k-value">${value}</div>` +
      `<div class="k-foot">${chip}<span class="k-sub">${sub}</span></div>`;
    w.appendChild(d);
  }
  return w;
}
function monthlyChart(series) {
  const max = Math.max(...series.flatMap(x => x.values), 1);
  const wrap = el("div", "chart");
  wrap.innerHTML = `<div class="legend">${series.map(x => `<b style="background:${x.color}"></b>${x.name}`).join(" ")}</div>` +
    `<div class="bars">` + MONTHS.map((m, i) =>
      `<div class="gbar"><div class="stack">` + series.map(x =>
        `<i style="height:${(x.values[i] || 0) / max * 100}%;background:${x.color}"></i>`).join("") +
      `</div><span>${m}</span></div>`).join("") + `</div>`;
  return wrap;
}
function rangeText(I, key) {
  const r = I.ranges && I.ranges[key];
  if (!r) return "";
  const one = ([y, m]) => (m ? `${MONTHS[m - 1]} ${y}` : String(y));
  return `${one(r.from)} – ${one(r.to)}`;
}
const restOf = (overall, smam) => (overall == null || smam == null || overall < smam) ? null : overall - smam;
function empty(msg, sub) {
  return card("No rows for this selection", msg + (sub ? " " + sub : ""), el("div", "empty", ""));
}


const PERIODS = [["3m", "Last 3 months"], ["6m", "Last 6 months"], ["12m", "Last 12 months"],
                 ["ytd", "This year (YTD)"], ["month", "Selected month"]];
function periodInfo(I, key, y, period, m) {
  const cy = y === "all" ? I.years.at(-1) : y;
  const map = key === "billca" ? (I.caBill[cy] || {}) : (I.caReg[cy] || {});
  const active = Object.keys(map).map(Number)
    .filter(k => sum((map[k] || {}).sc || {}) > 0).sort((a, b) => a - b);
  const last = active.length ? active[active.length - 1] : 12;
  const anchor = period === "month" ? Math.min(Math.max(m === "all" ? last : Number(m), 1), 12) : last;
  let months;
  if (period === "month") months = [anchor];
  else if (period === "ytd") months = Array.from({ length: anchor }, (_, i) => i + 1);
  else {
    const n = period === "6m" ? 6 : period === "12m" ? 12 : 3;
    const start = Math.max(1, anchor - n + 1);
    months = Array.from({ length: anchor - start + 1 }, (_, i) => start + i);
  }
  const label = period === "month" ? MONTHS[anchor - 1]
    : period === "ytd" ? `Jan–${MONTHS[anchor - 1]}`
      : `${MONTHS[months[0] - 1]}–${MONTHS[months[months.length - 1] - 1]}`;
  return { cy, map, months, anchor, label };
}

/* ------------------------------------------------------------------- views */
const VIEWS = {
  both(I, y, m) {
    const R = I.sales.RETAIL, W = I.sales.WHOLESALE, V = I.sales.VAHAN;
    const yrs = y === "all" ? I.years : [y];
    const has = yrs.some(yy => sum12(R[yy]) + sum12(W[yy]) + sum12(V[yy]));
    if (!has) return empty(`BOTH DATA has no sales for ${y}.`, `The tab covers ${rangeText(I, "both")}.`);
    const pick = (S, yy) => (m === "all" ? sum12(S[yy]) : ((S[yy] || [])[m - 1] || 0));
    const lastY = yrs[yrs.length - 1];
    const label = m === "all" ? `${lastY}` : `${MONTHS[m - 1]} ${lastY}`;
    const view = el("div");
    view.appendChild(kpiRow([
      ["Retail", fmt(pick(R, lastY)), null, `${label} units delivered`, "#0A4C95"],
      ["Wholesale", fmt(pick(W, lastY)), null, `${label} units billed`, "#128C7E"],
      ["VAHAN", fmt(pick(V, lastY)), null, `${label} registrations`, "#6C4AB6"],
      ["Retail growth", pct(growth(sum12(R[lastY]), sum12(R[lastY - 1])) * 100),
        growth(sum12(R[lastY]), sum12(R[lastY - 1])) * 100, "vs previous year", "#C0392B"]
    ]));
    const g1 = el("div", "grid2a");
    g1.appendChild(card(`Retail · wholesale · VAHAN — ${lastY}`,
      m === "all" ? "Monthly volumes from BOTH DATA." : `${MONTHS[m - 1]} is highlighted in the table.`,
      monthlyChart([
        { name: "Retail", color: "#0A4C95", values: MONTHS.map((_, i) => (R[lastY] || [])[i] || 0) },
        { name: "Wholesale", color: "#128C7E", values: MONTHS.map((_, i) => (W[lastY] || [])[i] || 0) },
        { name: "VAHAN", color: "#8E7CC3", values: MONTHS.map((_, i) => (V[lastY] || [])[i] || 0) }
      ])));
    g1.appendChild(card("Monthly detail", `Year ${lastY} · retail last year alongside`,
      table(["Month", "Retail", "Wholesale", "VAHAN", { v: "Retail LY", cls: "dim" }],
        MONTHS.map((mn, i) => rw([mn, (R[lastY] || [])[i] || "–", (W[lastY] || [])[i] || "–",
          (V[lastY] || [])[i] || "–", { v: (R[lastY - 1] || [])[i] || "–", cls: "dim" }],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    view.appendChild(g1);
    const g2 = el("div", "grid2");
    g2.appendChild(card("Year by year", "Every year present in the data.",
      table(["Year", "Retail", "Wholesale", "VAHAN", "Growth"],
        I.years.slice().reverse().map(yy => {
          const g = growth(sum12(R[yy]), sum12(R[yy - 1]));
          return rw([String(yy) + (yy === lastY ? " YTD" : ""), sum12(R[yy]), sum12(W[yy]), sum12(V[yy]) || "–",
            { v: g == null ? "–" : pct(g * 100), cls: g == null ? "dim" : (g >= 0 ? "pos" : "neg") }],
            { cls: y === yy ? "sel" : "" });
        }))));
    let models = {};
    if (y === "all") for (const yy of I.years) for (const [k, v] of Object.entries(I.models[yy] || {}))
      if (m === "all" || +k === m) mergeDeep(models, v);
    else for (const [k, v] of Object.entries(I.models[lastY] || {})) if (m === "all" || +k === m) mergeDeep(models, v);
    let unm = 0;
    if (y === "all") for (const yy of I.years) unm += m === "all" ? sum12(I.unmapped[yy]) : (I.unmapped[yy] || [])[m] || 0;
    else unm = m === "all" ? sum12(I.unmapped[lastY]) : (I.unmapped[lastY] || [])[m] || 0;
    const modelTotal = sum(models) || 1;
    g2.appendChild(card(`Models — ${label}`,
      `${fmt(modelTotal)} retail units with a model` + (unm ? ` · ${fmt(unm)} rows carry no model` : ""),
      table(["Model", "Retail", "Share"], topN(models, 15).map(([name, n]) =>
        rw([name, n, (n / modelTotal * 100).toFixed(1) + "%"])))));
    view.appendChild(g2);
    return view;
  },

  perf(I, y, m) {
    const view = el("div");
    const years = I.years.slice(-6);
    const sel = y === "all" ? I.years.at(-1) : y;
    const headers = ["Month"].concat(years.flatMap(yy => [`${yy} R`, `${yy} W`]));
    const rows = MONTHS.map((mn, i) => rw([mn].concat(years.flatMap(yy => [
      (I.sales.RETAIL[yy] || [])[i] || "–", (I.sales.WHOLESALE[yy] || [])[i] || "–"])),
      { cls: m !== "all" && i === m - 1 ? "sel" : "" }));
    const totals = ["TOTAL"].concat(years.flatMap(yy => [
      sum12(I.sales.RETAIL[yy]), sum12(I.sales.WHOLESALE[yy])]));
    view.appendChild(kpiRow([
      [`${sel} retail`, fmt(sum12(I.sales.RETAIL[sel])),
        growth(sum12(I.sales.RETAIL[sel]), sum12(I.sales.RETAIL[sel - 1])), "units", "#0A4C95"],
      [`${sel} wholesale`, fmt(sum12(I.sales.WHOLESALE[sel])),
        growth(sum12(I.sales.WHOLESALE[sel]), sum12(I.sales.WHOLESALE[sel - 1])), "units", "#128C7E"],
      [`${sel} VAHAN`, fmt(sum12(I.sales.VAHAN[sel])),
        growth(sum12(I.sales.VAHAN[sel]), sum12(I.sales.VAHAN[sel - 1])), "registrations", "#6C4AB6"],
      ["Years covered", String(I.years.length), null, `${I.years[0]}–${I.years.at(-1)}`, "#5B6B82"]
    ]));
    view.appendChild(card("Perfromance — month × year",
      (m !== "all" ? `${MONTHS[m - 1]} highlighted · ` : "") + "Retail (R) and wholesale (W) per month, last six years.",
      table(headers, rows.concat([`<tr class="tot">${rw(totals)}</tr>`]))));
    view.appendChild(card("Year totals", "Retail, wholesale and VAHAN by year.",
      table(["Year", "Retail", "Wholesale", "VAHAN"],
        I.years.slice().reverse().map(yy => rw([yy, fmt(sum12(I.sales.RETAIL[yy])),
          fmt(sum12(I.sales.WHOLESALE[yy])), fmt(sum12(I.sales.VAHAN[yy]))],
          { cls: yy === sel ? "sel" : "" })))));
    return view;
  },

  billing(I, y, m) {
    const map = yearMap(I.billing, y);
    const ms = monthList(map, m);
    const count = sumField(ms, "count");
    if (!count) return empty(`BILLING REGISTER MIS has no invoices for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,
      `The register covers ${rangeText(I, "billing")}.`);
    const margin = sumField(ms, "margin");
    const fin = mergeCounters(ms, "fin"), sp = mergeCounters(ms, "sp"), dist = mergeCounters(ms, "dist");
    const view = el("div");
    view.appendChild(kpiRow([
      ["Invoices", fmt(count), null, "in the selection", "#0A4C95"],
      ["Dealer margin", inr(margin), null, "total", "#1E8E5A"],
      ["Avg per invoice", inr(margin / count), null, "margin", "#128C7E"],
      ["Financiers", String(Object.keys(fin).length), null, "lenders used", "#6C4AB6"]
    ]));
    const g = el("div", "grid3");
    g.appendChild(card("Financier mix", "Invoices per financier.", barsTable(topN(fin, 15))));
    g.appendChild(card("Sales consultants", "Invoices raised.", barsTable(topN(sp, 15))));
    g.appendChild(card("Customer districts", "From the address column.", barsTable(topN(dist, 12))));
    view.appendChild(g);
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Invoices", "Margin"], MONTHS.map((mn, i) =>
        rw([mn, fmt((map[i + 1] || {}).count || 0), inr((map[i + 1] || {}).margin || 0)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  },

  offtake(I, y, m) {
    const map = yearMap(I.offtake, y);
    const ms = monthList(map, m);
    const count = sumField(ms, "count");
    if (!count) return empty(`OFF TAKE REPORT MIS has no rows for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,
      `The tab covers ${rangeText(I, "offtake")}.`);
    const vahan = sumField(ms, "vahan");
    const phys = mergeCounters(ms, "phys");
    const models = mergeCounters(ms, "model");
    let age = {};
    if (y === "all") for (const yy of I.years) for (const [k, v] of Object.entries(I.ageYM[yy] || {}))
      if (m === "all" || +k === m) mergeDeep(age, v);
    else for (const [k, v] of Object.entries(I.ageYM[y] || {})) if (m === "all" || +k === m) mergeDeep(age, v);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Off-take", fmt(count), null, "TM invoices", "#E07B00"],
      ["VAHAN uploaded", fmt(vahan), null, count ? pct(vahan / count * 100) + " of them" : "", "#0A4C95"],
      ["Most common status", Object.entries(phys).sort((a, b) => b[1] - a[1])[0]?.[0] || "–", null, "of vehicles", "#128C7E"],
      ["Over 180 days", fmt(age["180+ days"] || 0), null, "old stock", "#C0392B"]
    ]));
    const g = el("div", "grid3");
    g.appendChild(card("Physical status", "Where the vehicles stand.", barsTable(topN(phys, 10))));
    g.appendChild(card("Stock ageing", "Chassis age in days.", barsTable(Object.entries(age))));
    g.appendChild(card("Models taken", "By product line.", barsTable(topN(models, 12))));
    view.appendChild(g);
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Off-take", "VAHAN OK"], MONTHS.map((mn, i) =>
        rw([mn, fmt((map[i + 1] || {}).count || 0), fmt((map[i + 1] || {}).vahan || 0)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  },

  smam(I, y, m) {
    const map = yearMap(I.smam, y);
    const ms = monthList(map, m);
    const reg = sumField(ms, "reg");
    if (!reg) return empty(`SMAM RTO SHEET has no registrations for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,
      `The tab covers ${rangeText(I, "smam")}.`);
    const appr = sumField(ms, "appr"), pend = sumField(ms, "pend");
    const fees = sumField(ms, "fees"), tax = sumField(ms, "tax");
    const office = mergeCounters(ms, "office"), officeAppr = mergeCounters(ms, "officeAppr");
    const view = el("div");
    view.appendChild(kpiRow([
      ["Registrations", fmt(reg), null, "in the selection", "#0A4C95"],
      ["Approved", fmt(appr), null, pct(appr / reg * 100) + " of total", "#1E8E5A"],
      ["Pending", fmt(pend), null, pct(pend / reg * 100) + " waiting", "#D97706"],
      ["Fees + MV tax", inr(fees + tax), null, "collected", "#6C4AB6"]
    ]));
    view.appendChild(card("Registrations per office", "Top 25 offices in the selection.",
      table(["Office", "Regs", "Approved", "Pending"],
        topN(office, 25).map(([name, n]) => rw([name, fmt(n), fmt(officeAppr[name] || 0),
          fmt(n - (officeAppr[name] || 0))])))));
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Regs", "Approved", "Pending", "Fees", "MV tax"], MONTHS.map((mn, i) =>
        rw([mn, fmt((map[i + 1] || {}).reg || 0), fmt((map[i + 1] || {}).appr || 0),
          fmt((map[i + 1] || {}).pend || 0), inr((map[i + 1] || {}).fees || 0),
          inr((map[i + 1] || {}).tax || 0)], { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  },

  jammu(I, y, m) {
    const cy = y === "all" ? I.years.at(-1) : y;
    const ymap = I.jammu[cy];
    if (!ymap) return empty(`JAMMU DIVISION RTO SHEET has no data for ${cy}.`, `The tab covers ${rangeText(I, "jammu")}.`);
    const cur = monthTotals(ymap, m);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Industry", fmt(cur.industry || 0), null, m === "all" ? `PV registrations ${cy}` : `${MONTHS[m - 1]} ${cy}`, "#0A4C95"],
      ["TATA", fmt(cur.tata || 0), null, "units", "#128C7E"],
      ["TATA share", pct(cur.industry ? cur.tata / cur.industry * 100 : null), null, "of industry", "#6C4AB6"],
      ["Largest rival", Object.entries(cur.makers || {}).filter(([k]) => !k.startsWith("TATA"))
        .sort((a, b) => b[1] - a[1])[0]?.[0] || "–", null, "other maker", "#C0392B"]
    ]));
    view.appendChild(card(`Month by month — ${cy}`, "Industry and TATA per month. Pick a month above to drill in.",
      table(["Month", "Industry", "TATA", "TATA share"], MONTHS.map((mn, i) => {
        const M = ymap[i + 1] || {};
        return rw([mn, fmt(M.industry || 0), fmt(M.tata || 0),
          pct(M.industry ? M.tata / M.industry * 100 : null)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" });
      }))));
    const rto = Object.entries(cur.rto || {}).map(([k, v]) => ({
      rto: k, industry: v.ind, tata: v.tata,
      tataShare: v.ind ? v.tata / v.ind * 100 : null
    })).sort((a, b) => b.industry - a.industry);
    view.appendChild(card(`RTO / ARTO — ${cy}${m === "all" ? "" : " · " + MONTHS[m - 1]}`,
      "Volume and TATA share in each office for the selection.",
      table(["RTO", "Industry", "TATA", "TATA share"],
        rto.slice(0, 15).map(r => rw([r.rto, fmt(r.industry), fmt(r.tata), pct(r.tataShare)])))));
    view.appendChild(card("Makers", "Who leads the Jammu division in the selection.",
      barsTable(topN(cur.makers || {}, 12))));
    return view;
  },

  srinagar(I, y, m) {
    const S = I.srinagar;
    const cur = monthTotals(S.months, m);
    if (!cur.industry) return empty(`SRINAGAR DIVISION RTO SHEET has no data for ${m === "all" ? "this year" : MONTHS[m - 1]}.`,
      `The tab covers ${rangeText(I, "jammu") ? "" : ""}Jan–Dec 2026.`);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Industry", fmt(cur.industry), null, m === "all" ? "PV registrations 2026" : `${MONTHS[m - 1]} 2026`, "#0A4C95"],
      ["TATA", fmt(cur.tata), null, "units", "#128C7E"],
      ["TATA share", pct(cur.industry ? cur.tata / cur.industry * 100 : null), null, "of industry", "#6C4AB6"],
      ["Our valley registrations", fmt(sum(I.valley)), null, "SMAM RTO sheet (year)", "#C0392B"]
    ]));
    view.appendChild(card("Month by month — 2026", "Industry and TATA per month.",
      table(["Month", "Industry", "TATA", "TATA share"], MONTHS.map((mn, i) => {
        const M = S.months[i + 1] || {};
        return rw([mn, fmt(M.industry || 0), fmt(M.tata || 0),
          pct(M.industry ? M.tata / M.industry * 100 : null)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" });
      }))));
    const g = el("div", "grid2");
    g.appendChild(card(`By RTO — ${m === "all" ? "2026" : MONTHS[m - 1] + " 2026"}`, "Industry volume per office.",
      table(["RTO", "Units", "Share"], topN(cur.rto, 15).map(([k, v]) => rw([k, fmt(v),
        pct(cur.industry ? v / cur.industry * 100 : null)])))));
    g.appendChild(card("Maker mix", "Who sells in the valley.", barsTable(topN(cur.makers, 12))));
    view.appendChild(g);
    return view;
  },

  tatarest(I, y, m) {
    const cy = y === "all" ? I.years.at(-1) : y;
    const ymap = I.tatarest[cy];
    if (!ymap) return empty(`TATA MOTORS REST DEALER AND SMAM COUNT has no data for ${cy}.`,
      `The tab covers ${rangeText(I, "tatarest")}.`);
    const cur = monthTotals(ymap, m);
    const rest = (cur.overall || 0) - (cur.smam || 0);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Overall count", fmt(cur.overall || 0), null, m === "all" ? `${cy} all TATA` : `${MONTHS[m - 1]} ${cy}`, "#0A4C95"],
      ["SMAM count", fmt(cur.smam || 0), null, "our registrations", "#128C7E"],
      ["Rest dealer count", fmt(rest), null, "other TATA dealers", "#E07B00"],
      ["SMAM market share", pct(cur.overall ? cur.smam / cur.overall * 100 : null), null, "of overall TATA", "#C0392B"]
    ]));
    view.appendChild(card(`Month by month — ${cy}`,
      "Overall TATA = SMAM + rest dealers. A month shown as – means the overall TATA count is missing in that tab.",
      table(["Month", "Overall count", "SMAM count", "Rest dealer", "SMAM share", "Rest dealer share"],
        MONTHS.map((mn, i) => {
          const M = ymap[i + 1] || { smam: 0, overall: 0 };
          const r = restOf(M.overall, M.smam);
          return rw([mn, fmt(M.overall || 0), fmt(M.smam || 0), r == null ? "–" : fmt(r),
            pct(M.overall ? M.smam / M.overall * 100 : null),
            pct(r == null ? null : r / M.overall * 100)],
            { cls: m !== "all" && i === m - 1 ? "sel" : "" });
        }).concat([`<tr class="tot">${rw(["TOTAL",
          fmt(Object.values(ymap).reduce((a, x) => a + (x.overall || 0), 0)),
          fmt(Object.values(ymap).reduce((a, x) => a + (x.smam || 0), 0)),
          fmt(Object.values(ymap).reduce((a, x) => a + (x.overall || 0) - (x.smam || 0), 0)),
          pct((() => { const o = Object.values(ymap).reduce((a, x) => a + (x.overall || 0), 0);
            const sm = Object.values(ymap).reduce((a, x) => a + (x.smam || 0), 0);
            return o ? sm / o * 100 : null; })()),
          pct((() => { const o = Object.values(ymap).reduce((a, x) => a + (x.overall || 0), 0);
            const sm = Object.values(ymap).reduce((a, x) => a + (x.smam || 0), 0);
            return o ? (o - sm) / o * 100 : null; })())])}</tr>`]))));
    const rows = Object.entries(cur.rto || {}).map(([rto, v]) => {
      const r = restOf(v.overall, v.smam);
      return { rto, overall: v.overall || 0, smam: v.smam || 0, rest: r,
        smamShare: v.overall ? v.smam / v.overall * 100 : null,
        restShare: r == null ? null : r / v.overall * 100 };
    }).sort((a, b) => b.overall - a.overall);
    view.appendChild(card(`By RTO / ARTO — ${cy}${m === "all" ? "" : " · " + MONTHS[m - 1]}`,
      "Split of overall TATA volume between our dealership and other TATA dealers.",
      table(["RTO", "Overall", "SMAM", "Rest dealer", "SMAM share", "Rest share"],
        rows.slice(0, 20).map(r => rw([r.rto, fmt(r.overall), fmt(r.smam),
          r.rest == null ? "–" : fmt(r.rest), pct(r.smamShare), pct(r.restShare)])))));
    return view;
  },

  rtoca(I, y, m, outlet) {

    const map = yearMap(I.caReg, y);

    const ms = monthList(map, m);

    const outlets = mergeCounters(ms, "outlet");

    const scAll = mergeCounters(ms, "sc");

    if (!sum(scAll)) return empty(`RTO SHEET DEALER CA WISE has no registrations for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,

      `The tab covers ${rangeText(I, "rtoca")}.`);

    const scOut = mergeCounters(ms, "scOut");

    const picked = outlet && outlet !== "all" ? outlet : null;

    const sc = picked

      ? Object.fromEntries(Object.entries(scOut).filter(([k]) => k.startsWith(picked + "||"))

        .map(([k, v]) => [k.split("||")[1], v]))

      : scAll;

    const regs = picked ? sum(sc) : sum(scAll);

    const view = el("div");

    view.appendChild(kpiRow([

      ["Registrations", fmt(regs), null, picked ? `outlet: ${titleCase(picked)}` : "all outlets", "#0A4C95"],

      picked

        ? ["Share of all", pct(sum(outlets) ? regs / sum(outlets) * 100 : null), null, `of ${fmt(sum(outlets))} registrations`, "#128C7E"]

        : ["Outlets", String(Object.keys(outlets).length), null, "in the selection", "#128C7E"],

      picked

        ? ["Outlet", titleCase(picked), null, "selected above", "#6C4AB6"]

        : ["Top outlet", topN(outlets, 1)[0]?.[0] || "–", null, `${fmt(topN(outlets, 1)[0]?.[1] || 0)} registrations`, "#6C4AB6"],

      ["Consultants", String(Object.keys(sc).length), null, picked ? "in this outlet" : "active", "#5B6B82"]

    ]));

    const g = el("div", "grid2");

    g.appendChild(card("Outlet-wise count", "Registrations handled by each outlet.",

      table(["Outlet", "Registrations", "Share"], Object.entries(outlets).sort((a, b) => b[1] - a[1])

        .map(([k, v]) => rw([titleCase(k), fmt(v), pct(regs ? v / sum(outlets) * 100 : null)],

          { cls: picked === k ? "sel" : "" })))));

    g.appendChild(card(`Sales consultants${picked ? " — " + titleCase(picked) : ""}`,

      picked ? "Consultants who registered vehicles at this outlet." : "Top 20 consultants overall.",

      table(["Consultant", "Registrations"], topN(sc, 20).map(([k, v]) => rw([k, fmt(v)])))));

    view.appendChild(g);

    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,

      table(["Month", "Registrations", "Outlets active"], MONTHS.map((mn, i) => {

        const M = map[i + 1] || {};

        return rw([mn, fmt(sum(M.sc || {})), String(Object.keys(M.outlet || {}).length)],

          { cls: m !== "all" && i === m - 1 ? "sel" : "" });

      }))));

    return view;

  },





  rtocaavg(I, y, m, outlet, period) {
    const P = periodInfo(I, "rtoca", y, period, m);
    const ms = P.months.map(mm => P.map[String(mm)] || {});
    const sc = mergeCounters(ms, "sc");
    if (!sum(sc)) return empty(`RTO SHEET DEALER CA WISE has no registrations in that period.`,
      `The tab covers ${rangeText(I, "rtoca")}.`);
    const outlets = mergeCounters(ms, "outlet");
    const scOut = mergeCounters(ms, "scOut");
    const regs = sum(sc);
    const picked = outlet && outlet !== "all" ? outlet : null;
    const caPerOutlet = {};
    for (const k of Object.keys(scOut)) {
      const [o, c] = k.split("||");
      (caPerOutlet[o] ||= new Set()).add(c);
    }
    const scPicked = picked
      ? Object.fromEntries(Object.entries(scOut).filter(([k]) => k.startsWith(picked + "||"))
        .map(([k, v]) => [k.split("||")[1], v]))
      : sc;
    const nM = P.months.length;

    const view = el("div");
    view.appendChild(kpiRow([
      [`Registrations · ${P.label}`, fmt(picked ? sum(scPicked) : regs), null,
        picked ? `outlet ${titleCase(picked)}` : `${nM} month${nM > 1 ? "s" : ""}`, "#0A4C95"],
      ["Average / month", ((picked ? sum(scPicked) : regs) / nM).toFixed(1), null,
        `over ${nM} month${nM > 1 ? "s" : ""}`, "#128C7E"],
      ["CAs active", String(Object.keys(scPicked).length), null,
        picked ? `at ${titleCase(picked)}` : "in the period", "#6C4AB6"],
      ["Outlets", String(Object.keys(outlets).length), null, "with registrations", "#E07B00"]
    ]));

    const g = el("div", "grid2");
    g.appendChild(card("Outlet-wise performance",
      "Registrations, monthly average and how many CAs worked each outlet.",
      table(["Outlet", "Registrations", "Avg/month", "CAs", "Share"],
        Object.entries(outlets).sort((a, b) => b[1] - a[1]).map(([k, v]) => rw([
          titleCase(k), fmt(v), (v / nM).toFixed(1), String((caPerOutlet[k] || new Set()).size),
          pct(regs ? v / regs * 100 : null)], { cls: picked === k ? "sel" : "" })))));

    g.appendChild(card(`CA-wise performance${picked ? " — " + titleCase(picked) : ""}`,
      picked ? `Only ${titleCase(picked)}: ${fmt(sum(scPicked))} registrations over ${nM} months.`
        : "Every consultant, all outlets.",
      table(["Consultant", "Registrations", "Avg/month", "Share"],
        Object.entries(scPicked).sort((a, b) => b[1] - a[1]).map(([k, v]) => rw([
          k, fmt(v), (v / nM).toFixed(1),
          pct((picked ? sum(scPicked) : regs) ? v / (picked ? sum(scPicked) : regs) * 100 : null)])))));
    view.appendChild(g);

    view.appendChild(card("Month by month", `${P.cy} · selected period highlighted`,
      table(["Month", "Registrations", "CAs", "Outlets active", "Avg / CA"], MONTHS.map((mn, i) => {
        const M = P.map[String(i + 1)] || {};
        const n = sum(M.sc || {}), nc = Object.keys(M.sc || {}).length;
        return rw([mn, fmt(n), nc, Object.keys(M.outlet || {}).length, nc ? (n / nc).toFixed(1) : "–"],
          { cls: P.months.includes(i + 1) ? "sel" : "" });
      }))));
    return view;
  },

  billca(I, y, m, outlet) {

    const map = yearMap(I.caBill, y);

    const ms = monthList(map, m);

    const outlets = mergeCounters(ms, "outlet");

    const scAll = mergeCounters(ms, "sc");

    if (!sum(scAll)) return empty(`BILLING SHEET DEALER CA WISE has no invoices for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,

      `The tab covers ${rangeText(I, "billca")}.`);

    const scOut = mergeCounters(ms, "scOut");

    const discAll = sumField(ms, "disc");

    const discOut = mergeCounters(ms, "discOut");

    const picked = outlet && outlet !== "all" ? outlet : null;

    const sc = picked

      ? Object.fromEntries(Object.entries(scOut).filter(([k]) => k.startsWith(picked + "||"))

        .map(([k, v]) => [k.split("||")[1], v]))

      : scAll;

    const invoices = picked ? sum(sc) : sum(scAll);

    const disc = picked ? (discOut[picked] || 0) : discAll;

    const view = el("div");

    view.appendChild(kpiRow([

      ["Invoices", fmt(invoices), null, picked ? `outlet: ${titleCase(picked)}` : "all outlets", "#0A4C95"],

      picked

        ? ["Share of all", pct(sum(outlets) ? invoices / sum(outlets) * 100 : null), null, `of ${fmt(sum(outlets))} invoices`, "#128C7E"]

        : ["Outlets", String(Object.keys(outlets).length), null, "in the selection", "#128C7E"],

      ["Cash discount", inr(disc), null, picked ? "for this outlet" : "given", "#E07B00"],

      ["Consultants", String(Object.keys(sc).length), null, picked ? "in this outlet" : "active", "#6C4AB6"]

    ]));

    const g = el("div", "grid2");

    g.appendChild(card("Outlet-wise count", "Invoices billed by each outlet.",

      table(["Outlet", "Invoices", "Cash discount", "Share"], Object.entries(outlets).sort((a, b) => b[1] - a[1])

        .map(([k, v]) => rw([titleCase(k), fmt(v), inr(discOut[k] || 0),

          pct(sum(outlets) ? v / sum(outlets) * 100 : null)], { cls: picked === k ? "sel" : "" })))));

    g.appendChild(card(`Sales consultants${picked ? " — " + titleCase(picked) : ""}`,

      picked ? "Invoices raised by each consultant at this outlet." : "Top 20 consultants overall.",

      table(["Consultant", "Invoices"], topN(sc, 20).map(([k, v]) => rw([k, fmt(v)])))));

    view.appendChild(g);

    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,

      table(["Month", "Invoices", "Outlets active", "Cash discount"], MONTHS.map((mn, i) => {

        const M = map[i + 1] || {};

        return rw([mn, fmt(sum(M.sc || {})), String(Object.keys(M.outlet || {}).length), inr(M.disc || 0)],

          { cls: m !== "all" && i === m - 1 ? "sel" : "" });

      }))));

    return view;

  }

};

/* -------------------------------------------------------------------- boot */
let IDX = null;
const SEL = { report: "both", year: null, month: "all", outlet: "all", period: "ytd" };

function toolbar() {
  const bar = el("div", "toolbar");
  const field = (label, id, options, value) => {
    const wrap = el("label", "field");
    wrap.innerHTML = `<span>${label}</span>`;
    const sel = document.createElement("select");
    sel.id = id;
    options.forEach(([v, t]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = t; sel.appendChild(o);
    });
    sel.value = value;
    wrap.appendChild(sel);
    return wrap;
  };
  bar.appendChild(field("Report", "sel-report", ORDER.map(k => [k, TABS[k].name]), SEL.report));
  bar.appendChild(field("Year", "sel-year", [["all", "All years"]]
    .concat(IDX.years.slice().reverse().map(y => [String(y), String(y)])), String(SEL.year)));
  bar.appendChild(field("Month", "sel-month",
    [["all", "All months"]].concat(MONTHS.map((m, i) => [String(i + 1), m])), String(SEL.month)));
  if (TABS[SEL.report].period) {
    bar.appendChild(field("Period", "sel-period", PERIODS, String(SEL.period)));
  }
  if (TABS[SEL.report].outlet) {
    bar.appendChild(field("Outlet", "sel-outlet",
      [["all", "All outlets"]].concat(IDX.outlets.map(o => [o, titleCase(o)])), String(SEL.outlet)));
  }
  const btn = el("button", "refresh", "↻ Reload sheet");
  btn.onclick = () => boot();
  bar.appendChild(btn);
  bar.appendChild(el("div", "toolstamp",
    `live from Google Sheets<br><b>${new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b>`));
  return bar;
}

function syncUrl() {
  try {
    const q = new URLSearchParams({ report: SEL.report, year: SEL.year, month: SEL.month });
    if (TABS[SEL.report].period) q.set("period", SEL.period);
    if (TABS[SEL.report].outlet && SEL.outlet !== "all") q.set("outlet", SEL.outlet);
    history.replaceState(null, "", "?" + q.toString());
  } catch (e) { /* ignore */ }
}

function render() {
  const root = document.getElementById("app");
  root.innerHTML = "";
  const head = el("div", "top");
  head.innerHTML = `<div><div class="brand">SMAM Automart Pvt Ltd · Jammu &amp; Kashmir</div>
    <h1>Dealership Dashboard</h1>
    <div class="sub">Choose a tab report — only that report is shown</div></div>`;
  root.appendChild(head);
  root.appendChild(toolbar());

  const y = SEL.year, m = SEL.month;
  document.getElementById("sel-report").onchange = e => {
    SEL.report = e.target.value; SEL.outlet = "all"; syncUrl(); render();
  };
  document.getElementById("sel-year").onchange = e => { SEL.year = e.target.value; syncUrl(); render(); };
  document.getElementById("sel-month").onchange = e => { SEL.month = e.target.value; syncUrl(); render(); };
  const sp = document.getElementById("sel-period");
  if (sp) sp.onchange = e => { SEL.period = e.target.value; syncUrl(); render(); };
  const so = document.getElementById("sel-outlet");
  if (so) so.onchange = e => { SEL.outlet = e.target.value; syncUrl(); render(); };

  const title = el("div", "reporthead");
  title.innerHTML = `<span class="pill">${TABS[SEL.report].name}</span>
    <span class="muted">${y === "all" ? "all years" : y} · ${m === "all" ? "all months" : MONTHS[m - 1]}` +
    (TABS[SEL.report].period ? ` · ${(PERIODS.find(p => p[0] === SEL.period) || ["", ""])[1]}` : "") +
    (TABS[SEL.report].outlet && SEL.outlet !== "all" ? ` · outlet ${titleCase(SEL.outlet)}` : "") + `</span>`;
  root.appendChild(title);

  const body = el("div", "report");
  try {
    body.appendChild(VIEWS[SEL.report](IDX, y === "all" ? "all" : Number(y), m, SEL.outlet, SEL.period));
  } catch (err) {
    body.appendChild(el("div", "error", `<b>This report could not be drawn.</b><br>${err.message}`));
  }
  root.appendChild(body);
  syncUrl();

  const foot = el("div", "foot");
  foot.innerHTML = `<span>SMAM Automart Pvt Ltd · source:
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener">dealer workbook</a></span>
    <span class="pill">build ${BUILD}</span>`;
  root.appendChild(foot);
}

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
    await Promise.all(Object.entries(TABS).map(async ([k, t]) => { tabs[k] = await loadTab(t.gid); }));
    IDX = buildIndex(tabs);
    const q = new URLSearchParams(location.search);
    if (q.get("report") && ORDER.includes(q.get("report"))) SEL.report = q.get("report");
    const qy = q.get("year");
    SEL.year = qy === "all" ? "all"
      : (qy && IDX.years.map(String).includes(qy)) ? qy : String(IDX.years.at(-1));
    const qm = q.get("month");
    SEL.month = qm && (qm === "all" || (Number(qm) >= 1 && Number(qm) <= 12)) ? qm : "all";
    const qp = q.get("period");
    SEL.period = qp && PERIODS.some(p => p[0] === qp) ? qp : "ytd";
    const qo = q.get("outlet");
    SEL.outlet = qo && IDX.outlets.includes(qo) ? qo : "all";
    render();
  } catch (err) {
    root.innerHTML = `<div class="error"><b>Could not read the sheet.</b><br>${err.message}<br><br>
      The workbook must stay shared as <i>anyone with the link → viewer</i>.</div>`;
  }
}

if (typeof window !== "undefined") window.__BUILD = BUILD;
if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { buildIndex, parseCsv, dt, num, VIEWS, MONTHS };
