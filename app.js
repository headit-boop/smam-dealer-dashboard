/* SMAM Automart — dealer dashboard.
 * One report per tab, chosen from a dropdown; year and month filters apply to
 * every report. Data is read from the Google Sheet in the browser on load.
 */
const SHEET_ID = "15JZOzlxUKAStJpVLxFwRnbLMsHsV1f5B5_NeegUHVxA";

const TABS = {
  both:     { gid: "1083590020", name: "BOTH DATA", annual: false },
  perf:     { gid: "744351213",  name: "Perfromance", annual: false },
  billing:  { gid: "1144355488", name: "BILLING REGISTER MIS", annual: false },
  offtake:  { gid: "1536373224", name: "OFF TAKE REPORT MIS", annual: false },
  smam:     { gid: "402409727",  name: "SMAM RTO SHEET", annual: false },
  jammu:    { gid: "1194097827", name: "JAMMU DIVISION RTO SHEET", annual: true },
  srinagar: { gid: "782469727",  name: "SRINAGAR DIVISION RTO SHEET", annual: true },
  tatarest: { gid: "1250415802", name: "TATA MOTORS REST DEALER AND SMAM COUNT", annual: true },
  rtoca:    { gid: "1456155471", name: "RTO SHEET DEALER CA WISE", annual: false },
  billca:   { gid: "353226043",  name: "BILLING SHEET DEALER CA WISE", annual: false }
};
const ORDER = ["both", "perf", "billing", "offtake", "smam", "jammu", "srinagar", "tatarest", "rtoca", "billca"];
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
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = t.match(/^(\d{1,2})[-/ ]([A-Za-z]{3,})[-/ ](\d{2,4})/);
  if (m) {
    const mi = MONTHS.findIndex(x => m[2].toLowerCase().startsWith(x.toLowerCase()));
    if (mi >= 0) { let y = +m[3]; if (y < 100) y += 2000; return { y, m: mi + 1, d: +m[1] }; }
  }
  m = t.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    if (y < 1990 || y > 2100) return null;
    return { y, m: +m[2], d: +m[1] };
  }
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
const add = (o, k, n = 1) => { o[k] = (o[k] || 0) + n; };
const topN = (o, n) => Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, n);
const sum = (o = {}) => Object.values(o || {}).reduce((a, b) => a + b, 0);
const sum12 = a => (a || []).reduce((x, y) => x + (y || 0), 0);

/* -------------------------------------------------------------------- index */
function buildIndex(T) {
  const rows = k => (T[k] || []).slice(1).filter(r => r.some(x => s(x) !== ""));

  const offtakeRaw = rows("offtake");
  const billingRaw = rows("billing");
  const modelMap = {};
  for (const r of offtakeRaw) { const c = s(r[1]), m = s(r[3]); if (c && m && !modelMap[c]) modelMap[c] = m; }
  for (const r of billingRaw) { const c = s(r[3]), m = s(r[5]); if (c && m && !modelMap[c]) modelMap[c] = m; }

  /* sales, models per year + month */
  const sales = { RETAIL: {}, WHOLESALE: {}, VAHAN: {} };
  const models = {}, unmapped = {};
  for (const r of rows("both")) {
    const st = s(r[4]).toUpperCase();
    if (!sales[st]) continue;
    const d = dt(r[0]);
    const y = Math.round(num(r[6]) || (d ? d.y : 0));
    if (!y) continue;
    const mtxt = s(r[5]).slice(0, 3).toLowerCase();
    let mi = MONTHS.findIndex(x => x.toLowerCase() === mtxt);
    if (mi < 0 && d) mi = d.m - 1;
    if (mi < 0) continue;
    (sales[st][y] ||= new Array(12).fill(0))[mi] += 1;
    if (st === "RETAIL") {
      const model = s(r[2]) || modelMap[s(r[1])] || "Unmapped";
      const M = ((models[y] ||= {})[mi + 1] ||= {});
      if (model === "Unmapped") { (unmapped[y] ||= new Array(13).fill(0))[mi + 1] += 1; }
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

  /* jammu market */
  const jammu = {};
  for (const r of rows("jammu")) {
    const y = Math.round(num(r[5]) || 0), c = num(r[4]) || 0;
    if (!y || !c) continue;
    const Y = (jammu[y] ||= { industry: 0, tata: 0, rto: {}, makers: {} });
    Y.industry += c;
    const isTata = s(r[0]).toUpperCase().startsWith("TATA");
    if (isTata) Y.tata += c;
    add(Y.makers, s(r[0]).toUpperCase() || "Unknown", c);
    const rto = s(r[1]).toUpperCase();
    if (rto) {
      const R = (Y.rto[rto] ||= { ind: 0, tata: 0 });
      R.ind += c; if (isTata) R.tata += c;
    }
  }

  /* srinagar */
  const srin = { industry: 0, tata: 0, rto: {}, makers: {} };
  for (const r of rows("srinagar")) {
    const c = num(r[3]) || 0;
    srin.industry += c;
    const maker = s(r[0]).toUpperCase();
    add(srin.makers, maker, c);
    add(srin.rto, s(r[1]).toUpperCase(), c);
    if (maker.startsWith("TATA")) srin.tata += c;
  }

  /* tata rest dealer */
  const tatarest = {};
  for (const r of rows("tatarest")) {
    const y = Math.round(num(r[4]) || 0), c = num(r[3]) || 0;
    const st = s(r[5]).toUpperCase();
    if (!y) continue;
    const Y = (tatarest[y] ||= { smam: 0, overall: 0, rto: {} });
    if (st === "SMAM COUNT") { Y.smam += c; add(Y.rto, s(r[1]).toUpperCase() || "Unknown", c); }
    else if (st === "OVER ALL COUNT") Y.overall += c;
  }

  /* CA tabs */
  const caReg = {}, caBill = {};
  for (const r of rows("rtoca")) {
    const d = dt(r[0]); if (!d) continue;
    const M = (((caReg[d.y] ||= {})[d.m]) ||= { sc: {}, outlet: {} });
    add(M.sc, s(r[6]).toUpperCase() || "Not recorded");
    add(M.outlet, s(r[5]).toUpperCase() || "Not recorded");
  }
  for (const r of rows("billca")) {
    const d = dt(r[0]); if (!d) continue;
    const M = (((caBill[d.y] ||= {})[d.m]) ||= { sc: {}, disc: 0 });
    add(M.sc, s(r[7]).toUpperCase() || "Not recorded");
    M.disc += num(r[8]) || 0;
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
  function yearSpan(map) {
    const ys = Object.keys(map).map(Number).sort((a, b) => a - b);
    return ys.length ? { from: [ys[0], 0], to: [ys[ys.length - 1], 0] } : null;
  }
  const ranges = {
    both: span(sales.RETAIL), billing: span(billing), offtake: span(offtake),
    smam: span(smam), rtoca: span(caReg), billca: span(caBill),
    jammu: yearSpan(jammu), tatarest: yearSpan(tatarest)
  };

  const years = [...new Set([...Object.keys(sales.RETAIL), ...Object.keys(billing),
    ...Object.keys(offtake), ...Object.keys(smam), ...Object.keys(jammu),
    ...Object.keys(tatarest), ...Object.keys(caReg), ...Object.keys(caBill)].map(Number))]
    .sort((a, b) => a - b);

  return { sales, models, unmapped, billing, offtake, offtakeModel, ageY, ageYM,
           smam, jammu, srinagar: srin, tatarest, caReg, caBill, valley, years, ranges };
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
function jammuRto(I, year) {
  const Y = I.jammu[year]; if (!Y) return [];
  const own = {};
  for (const M of Object.values(I.smam[year] || {}))
    for (const [office, n] of Object.entries(M.office || {})) {
      const key = office.toUpperCase().replace(/\(\s*JK\s*-?\s*\d*\s*\)/g, "")
        .replace(/\s+(ARTO|RTO)\s*$/, "").replace(/\b(ARTO|RTO)\b/g, "")
        .replace(/-/g, " ").replace(/\s+/g, " ").trim();
      if (key) add(own, key, n);
    }
  return Object.entries(Y.rto).map(([rto, v]) => ({
    rto, industry: v.ind, tata: v.tata, smam: own[rto] || 0,
    tataShare: v.ind ? v.tata / v.ind * 100 : null,
    smamOfTata: v.tata ? (own[rto] || 0) / v.tata * 100 : null
  })).sort((a, b) => b.industry - a.industry);
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
function empty(msg, sub) {
  return card("No rows for this selection", msg + (sub ? " " + sub : ""), el("div", "empty", ""));
}

/* ------------------------------------------------------------------- views */
const VIEWS = {
  both(I, y, m) {
    const R = I.sales.RETAIL, W = I.sales.WHOLESALE, V = I.sales.VAHAN;
    const yrs = y === "all" ? I.years : [y];
    const has = yrs.some(yy => sum12(R[yy]) + sum12(W[yy]) + sum12(V[yy]));
    if (!has) return empty(`BOTH DATA has no sales for ${y}.`, `The tab covers ${rangeText(I, "both")}.`);

    const pick = (S, yy) => (m === "all" ? sum12(S[yy]) : ((S[yy] || [])[m - 1] || 0));
    const totAll = (S, yy) => sum12(S[yy]);
    const view = el("div");
    const lastY = yrs[yrs.length - 1];
    const label = m === "all" ? `${lastY}` : `${MONTHS[m - 1]} ${lastY}`;

    view.appendChild(kpiRow([
      ["Retail", fmt(y === "all" ? yrs.reduce((a, yy) => a + pick(R, yy), 0) : pick(R, lastY)),
        null, `${label} units delivered`, "#0A4C95"],
      ["Wholesale", fmt(y === "all" ? yrs.reduce((a, yy) => a + pick(W, yy), 0) : pick(W, lastY)),
        null, `${label} units billed`, "#128C7E"],
      ["VAHAN", fmt(y === "all" ? yrs.reduce((a, yy) => a + pick(V, yy), 0) : pick(V, lastY)),
        null, `${label} registrations`, "#6C4AB6"],
      ["Retail growth", pct(growth(totAll(R, lastY), totAll(R, lastY - 1)) * 100),
        growth(totAll(R, lastY), totAll(R, lastY - 1)) * 100, "vs previous year", "#C0392B"]
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
        MONTHS.map((mn, i) => rw([mn,
          (R[lastY] || [])[i] || "–", (W[lastY] || [])[i] || "–", (V[lastY] || [])[i] || "–",
          { v: (R[lastY - 1] || [])[i] || "–", cls: "dim" }],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    view.appendChild(g1);

    const g2 = el("div", "grid2");
    g2.appendChild(card("Year by year", "Every year present in the data.",
      table(["Year", "Retail", "Wholesale", "VAHAN", "Growth"],
        I.years.slice().reverse().map(yy => {
          const g = growth(totAll(R, yy), totAll(R, yy - 1));
          return rw([String(yy) + (yy === lastY ? " YTD" : ""), totAll(R, yy), totAll(W, yy),
            totAll(V, yy) || "–",
            { v: g == null ? "–" : pct(g * 100), cls: g == null ? "dim" : (g >= 0 ? "pos" : "neg") }],
            { cls: y === yy ? "sel" : "" });
        }))));

    const mm = m === "all" ? null : m;
    let models = {};
    if (y === "all") for (const yy of I.years) for (const [k, v] of Object.entries(I.models[yy] || {}))
      if (!mm || +k === mm) mergeDeep(models, v);
    else for (const [k, v] of Object.entries(I.models[lastY] || {})) if (!mm || +k === mm) mergeDeep(models, v);

    let unm = 0;
    if (y === "all") for (const yy of I.years) unm += mm ? (I.unmapped[yy] || [])[mm] || 0 : sum12(I.unmapped[yy]);
    else unm = mm ? (I.unmapped[lastY] || [])[mm] || 0 : sum12(I.unmapped[lastY]);

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
    const office = mergeCounters(ms, "office");
    const officeAppr = mergeCounters(ms, "officeAppr");
    const view = el("div");
    view.appendChild(kpiRow([
      ["Registrations", fmt(reg), null, "in the selection", "#0A4C95"],
      ["Approved", fmt(appr), null, pct(appr / reg * 100) + " of total", "#1E8E5A"],
      ["Pending", fmt(pend), null, pct(pend / reg * 100) + " waiting", "#D97706"],
      ["Fees + MV tax", inr(fees + tax), null, "collected", "#6C4AB6"]
    ]));
    view.appendChild(card("Registrations per office", "Top 25 offices in the selection.",
      table(["Office", "Regs", "Approved", "Pending"],
        topN(office, 25).map(([name, n]) => {
          const a = officeAppr[name] || 0;
          return rw([name, fmt(n), fmt(a), fmt(n - a)]);
        }))));
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Regs", "Approved", "Pending", "Fees", "MV tax"], MONTHS.map((mn, i) =>
        rw([mn, fmt((map[i + 1] || {}).reg || 0), fmt((map[i + 1] || {}).appr || 0),
          fmt((map[i + 1] || {}).pend || 0), inr((map[i + 1] || {}).fees || 0),
          inr((map[i + 1] || {}).tax || 0)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  },

  jammu(I, y) {
    const cy = y === "all" ? I.years.at(-1) : y;
    const Y = I.jammu[cy];
    if (!Y) return empty(`JAMMU DIVISION RTO SHEET has no data for ${cy}.`,
      `The tab covers ${rangeText(I, "jammu")}.`);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Industry", fmt(Y.industry), null, `PV registrations ${cy}`, "#0A4C95"],
      ["TATA", fmt(Y.tata), null, "units", "#128C7E"],
      ["TATA share", pct(Y.industry ? Y.tata / Y.industry * 100 : null), null, "of industry", "#6C4AB6"],
      ["Largest rival", Object.entries(Y.makers).filter(([k]) => !k.startsWith("TATA"))
        .sort((a, b) => b[1] - a[1])[0]?.[0] || "–", null, "other maker", "#C0392B"]
    ]));
    view.appendChild(card("Market by year", "Industry vs TATA vs our registrations. (This tab is yearly — the month filter does not apply.)",
      table(["Year", "Industry", "TATA", "SMA", "TATA share", "SMA of TATA"], I.years.map(yy => {
        const M = I.jammu[yy]; if (!M) return rw([yy, "–", "–", "–", "–", "–"]);
        const own = Object.values(I.smam[yy] || {}).reduce((a, x) => a + x.reg, 0);
        return rw([yy, fmt(M.industry), fmt(M.tata), fmt(own),
          pct(M.industry ? M.tata / M.industry * 100 : null),
          pct(M.tata ? own / M.tata * 100 : null)], { cls: yy === cy ? "sel" : "" });
      }))));
    view.appendChild(card(`RTO / ARTO — ${cy}`, "Volume, TATA share and our share in each office.",
      table(["RTO", "Industry", "TATA", "SMA", "TATA share", "SMA of TATA"],
        jammuRto(I, cy).slice(0, 15).map(r => rw([r.rto, fmt(r.industry), fmt(r.tata), fmt(r.smam),
          pct(r.tataShare), pct(r.smamOfTata)])))));
    view.appendChild(card("Makers", "Who leads the Jammu division.", barsTable(topN(Y.makers, 12))));
    return view;
  },

  srinagar(I) {
    const S = I.srinagar;
    if (!S.industry) return empty("SRINAGAR DIVISION RTO SHEET is empty.");
    const view = el("div");
    view.appendChild(kpiRow([
      ["Industry", fmt(S.industry), null, "PV registrations", "#0A4C95"],
      ["TATA", fmt(S.tata), null, "units", "#128C7E"],
      ["TATA share", pct(S.industry ? S.tata / S.industry * 100 : null), null, "of industry", "#6C4AB6"],
      ["Our valley registrations", fmt(sum(I.valley)), null, "SMAM RTO sheet", "#C0392B"]
    ]));
    const g = el("div", "grid2");
    g.appendChild(card("By RTO", "Industry volume per office. (Yearly tab — month filter does not apply.)",
      table(["RTO", "Units", "Share"], topN(S.rto, 15).map(([k, v]) => rw([k, fmt(v),
        pct(S.industry ? v / S.industry * 100 : null)])))));
    g.appendChild(card("Maker mix", "Who sells in the valley.", barsTable(topN(S.makers, 12))));
    view.appendChild(g);
    return view;
  },

  tatarest(I, y) {
    const cy = y === "all" ? I.years.at(-1) : y;
    const Y = I.tatarest[cy];
    if (!Y) return empty(`TATA MOTORS REST DEALER AND SMAM COUNT has no data for ${cy}.`,
      `The tab covers ${rangeText(I, "tatarest")}.`);
    const view = el("div");
    view.appendChild(kpiRow([
      ["SMAM count", fmt(Y.smam), null, `${cy} registrations`, "#0A4C95"],
      ["Overall TATA", fmt(Y.overall), null, "same offices", "#128C7E"],
      ["Our share", pct(Y.overall ? Y.smam / Y.overall * 100 : null), null, "of TATA volume", "#C0392B"],
      ["Offices", String(Object.keys(Y.rto).length), null, "with our volume", "#5B6B82"]
    ]));
    view.appendChild(card("Year by year", "SMAM vs overall TATA count.",
      table(["Year", "SMAM", "Overall TATA", "Share"], I.years.map(yy => {
        const T = I.tatarest[yy]; if (!T) return rw([yy, "–", "–", "–"]);
        return rw([yy, fmt(T.smam), fmt(T.overall), pct(T.overall ? T.smam / T.overall * 100 : null)],
          { cls: yy === cy ? "sel" : "" });
      }))));
    view.appendChild(card(`Offices — ${cy}`, "Our registrations by RTO/ARTO.",
      table(["RTO", "SMAM", "Share of our total"],
        topN(Y.rto, 20).map(([k, v]) => rw([k, fmt(v), pct(Y.smam ? v / Y.smam * 100 : null)])))));
    return view;
  },

  rtoca(I, y, m) {
    const map = yearMap(I.caReg, y);
    const ms = monthList(map, m);
    const sc = mergeCounters(ms, "sc"), outlet = mergeCounters(ms, "outlet");
    if (!sum(sc)) return empty(`RTO SHEET DEALER CA WISE has no registrations for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,
      `The tab covers ${rangeText(I, "rtoca")}.`);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Registrations", fmt(sum(sc)), null, "handled", "#0A4C95"],
      ["Consultants", String(Object.keys(sc).length), null, "active", "#128C7E"],
      ["Top consultant", Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] || "–", null, "by registrations", "#6C4AB6"],
      ["Outlets", String(Object.keys(outlet).length), null, "used", "#5B6B82"]
    ]));
    const g = el("div", "grid2");
    g.appendChild(card("Registrations per consultant", "Top 20.", barsTable(topN(sc, 20))));
    g.appendChild(card("By outlet", "Where they were registered.", barsTable(topN(outlet, 10))));
    view.appendChild(g);
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Registrations"], MONTHS.map((mn, i) =>
        rw([mn, fmt(sum((map[i + 1] || {}).sc || {}))],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  },

  billca(I, y, m) {
    const map = yearMap(I.caBill, y);
    const ms = monthList(map, m);
    const sc = mergeCounters(ms, "sc"), disc = sumField(ms, "disc");
    if (!sum(sc)) return empty(`BILLING SHEET DEALER CA WISE has no invoices for ${y}${m === "all" ? "" : " " + MONTHS[m - 1]}.`,
      `The tab covers ${rangeText(I, "billca")}.`);
    const view = el("div");
    view.appendChild(kpiRow([
      ["Invoices", fmt(sum(sc)), null, "billed", "#0A4C95"],
      ["Consultants", String(Object.keys(sc).length), null, "active", "#128C7E"],
      ["Cash discount", inr(disc), null, "given", "#E07B00"],
      ["Top consultant", Object.entries(sc).sort((a, b) => b[1] - a[1])[0]?.[0] || "–", null, "by invoices", "#6C4AB6"]
    ]));
    view.appendChild(card("Invoices per consultant", "Top 20.", barsTable(topN(sc, 20))));
    view.appendChild(card("Month by month", y === "all" ? "All years" : `Year ${y}`,
      table(["Month", "Invoices", "Cash discount"], MONTHS.map((mn, i) =>
        rw([mn, fmt(sum((map[i + 1] || {}).sc || {})), inr((map[i + 1] || {}).disc || 0)],
          { cls: m !== "all" && i === m - 1 ? "sel" : "" })))));
    return view;
  }
};

/* -------------------------------------------------------------------- boot */
let IDX = null, TABS_RAW = null;
const SEL = { report: "both", year: null, month: "all" };

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
  document.getElementById("sel-report").onchange = e => { SEL.report = e.target.value; syncUrl(); render(); };
  document.getElementById("sel-year").onchange = e => { SEL.year = e.target.value; syncUrl(); render(); };
  document.getElementById("sel-month").onchange = e => { SEL.month = e.target.value; syncUrl(); render(); };

  const title = el("div", "reporthead");
  title.innerHTML = `<span class="pill">${TABS[SEL.report].name}</span>
    <span class="muted">${y === "all" ? "all years" : y} · ${m === "all" ? "all months" : MONTHS[m - 1]}</span>`;
  if (TABS[SEL.report].annual && m !== "all") title.innerHTML += ` <span class="note">this tab is yearly — month does not apply</span>`;
  root.appendChild(title);

  const body = el("div", "report");
  try {
    body.appendChild(VIEWS[SEL.report](IDX, y === "all" ? "all" : Number(y), m));
  } catch (err) {
    body.appendChild(el("div", "error", `<b>This report could not be drawn.</b><br>${err.message}`));
  }
  root.appendChild(body);
  syncUrl();

  const foot = el("div", "foot");
  foot.innerHTML = `<span>SMAM Automart Pvt Ltd · source:
      <a href="https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit" target="_blank" rel="noopener">dealer workbook</a></span>
    <span class="pill">github pages</span>`;
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
    TABS_RAW = tabs;
    IDX = buildIndex(tabs);
    const q = new URLSearchParams(location.search);
    if (q.get("report") && ORDER.includes(q.get("report"))) SEL.report = q.get("report");
    const qy = q.get("year");
    SEL.year = qy === "all" ? "all"
      : (qy && IDX.years.map(String).includes(qy)) ? qy : String(IDX.years.at(-1));
    const qm = q.get("month");
    SEL.month = qm && (qm === "all" || (Number(qm) >= 1 && Number(qm) <= 12)) ? qm : "all";
    render();
  } catch (err) {
    root.innerHTML = `<div class="error"><b>Could not read the sheet.</b><br>${err.message}<br><br>
      The workbook must stay shared as <i>anyone with the link → viewer</i>.</div>`;
  }
}

if (typeof document !== "undefined") boot();
if (typeof module !== "undefined") module.exports = { buildIndex, parseCsv, dt, num, VIEWS };
