// FinScan Web App — Block 5: universe dashboard.
// KPIs + filters + sortable table. Reads core columns + the `data` jsonb blob.
// RLS already caps what each user can read (free: top 3, sub: full universe).

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const VERDICT_CLASS = {
    "Outperforming": "v-out", "Performing": "v-perf",
    "Neutral": "v-neut", "Underperforming": "v-under", "Weak": "v-weak",
  };

  // Table columns. src "row" = promoted column; src "data" = inside jsonb blob.
  const SIMPLE_COLS = [
    { k: "rank",          label: "#",        num: true, src: "row" },
    { k: "symbol",        label: "Symbol",              src: "row" },
    { k: "name",          label: "Name",                src: "row" },
    { k: "verdict",       label: "Verdict",             src: "row" },
    { k: "score",         label: "Score",    num: true, src: "row" },
    { k: "data_flag",     label: "Note",                src: "data" },
    { k: "last_price",    label: "Price",    num: true, src: "row", money: true },
    { k: "valuation",     label: "Valuation",     src: "data", cat: true },
    { k: "growth",        label: "Growth",        src: "data", cat: true },
    { k: "profitability", label: "Profitability", src: "data", cat: true },
    { k: "health",        label: "Health",        src: "data", cat: true },
    { k: "sentiment",     label: "Sentiment",     src: "data", cat: true },
    { k: "upside",        label: "Upside %", num: true, src: "data", pct: true },
    { k: "category",      label: "Category",      src: "row" },
  ];

  // Full Analysis — every metric (mirrors the Excel "Full Analysis" sheet).
  const FULL_COLS = [
    { k: "rank",            label: "#",            num: true, src: "row" },
    { k: "symbol",          label: "Symbol",                  src: "row" },
    { k: "name",            label: "Name",                    src: "row" },
    { k: "score",           label: "Score",        num: true, src: "row" },
    { k: "last_price",      label: "Price",        num: true, src: "row", money: true },
    { k: "data_flag",       label: "Note",                    src: "data" },
    { k: "peg_ttm",         label: "PEG",          num: true, src: "data" },
    { k: "pe_ttm",          label: "P/E",          num: true, src: "data" },
    { k: "pe_forward",      label: "Fwd P/E",      num: true, src: "data" },
    { k: "ps_ratio",        label: "P/S",          num: true, src: "data" },
    { k: "pb_ratio",        label: "P/B",          num: true, src: "data" },
    { k: "ev_ebitda",       label: "EV/EBITDA",    num: true, src: "data" },
    { k: "eps_beat",        label: "EPS Beat",                src: "data" },
    { k: "eps_surprise_pct",label: "EPS Surprise %", num: true, src: "data", pct: true },
    { k: "eps_growth_yoy",  label: "EPS Growth %", num: true, src: "data", pct: true },
    { k: "rev_growth_yoy",  label: "Rev Growth %", num: true, src: "data", pct: true },
    { k: "gross_margin",    label: "Gross Margin %", num: true, src: "data", pct: true },
    { k: "oper_margin",     label: "Op Margin %",  num: true, src: "data", pct: true },
    { k: "net_margin",      label: "Net Margin %", num: true, src: "data", pct: true },
    { k: "roe",             label: "ROE %",        num: true, src: "data", pct: true },
    { k: "roa",             label: "ROA %",        num: true, src: "data", pct: true },
    { k: "fcf_margin",      label: "FCF Margin %", num: true, src: "data", pct: true },
    { k: "debt_equity",     label: "Debt/Eq",      num: true, src: "data" },
    { k: "current_ratio",   label: "Current Ratio",num: true, src: "data" },
    { k: "div_yield",       label: "Div Yield %",  num: true, src: "data", pct: true },
    { k: "target_price",    label: "Target $",     num: true, src: "data", money: true },
    { k: "insider_own_pct", label: "Insider %",    num: true, src: "data", pct: true },
    { k: "inst_own",        label: "Inst %",       num: true, src: "data", pct: true },
    { k: "short_float_pct", label: "Short Float %",num: true, src: "data", pct: true },
    { k: "sentiment",       label: "Sentiment",               src: "data", cat: true },
    { k: "news_sentiment",  label: "News Tone",    num: true, src: "data" },
    { k: "rs_3m",           label: "vs Sector 3M", num: true, src: "data" },
    { k: "earnings_date",   label: "Next Earnings",           src: "data" },
    { k: "beta",            label: "Beta",         num: true, src: "data" },
    { k: "trend",           label: "EMA Trend",               src: "data" },
    { k: "ema_stack",       label: "EMA Stack",               src: "data" },
    { k: "macd_tag",        label: "MACD",                    src: "data" },
    { k: "bb_signal",       label: "Bollinger",               src: "data" },
    { k: "golden_cross",    label: "Golden Cross",            src: "data" },
    { k: "rsi",             label: "RSI",          num: true, src: "data" },
    { k: "pct_off_high",    label: "% off 52w High", num: true, src: "data", pct: true },
    { k: "market_cap",      label: "Market Cap",   num: true, src: "row", big: true },
    { k: "sector",          label: "Sector",                  src: "row" },
  ];

  let viewMode = "simple";                       // "simple" | "full"
  const activeCols = () => (viewMode === "full" ? FULL_COLS : SIMPLE_COLS);

  // Categorical badge colour by sentiment (no buy/sell wording).
  const CAT_GOOD = new Set(["Very Cheap", "Cheap", "High Growth", "Growing",
    "Highly Profitable", "Profitable", "Very Healthy", "Healthy",
    "Bullish", "Leaning Bullish"]);
  const CAT_BAD = new Set(["Expensive", "Very Expensive", "Declining",
    "Loss-Making", "High Debt", "Bearish", "Leaning Bearish"]);
  const catClass = (v) =>
    CAT_GOOD.has(v) ? "cat-good" : CAT_BAD.has(v) ? "cat-bad" : "cat-mid";

  let ROWS = [];
  let VIEW = [];                       // current filtered + sorted rows (for export)
  let SB = null;                       // supabase client (for the export auth token)
  let sortKey = "rank", sortDir = 1;   // 1 asc, -1 desc
  let wired = false;

  // Core columns first, then every field from the data jsonb (full dataset).
  const CORE_KEYS = ["rank", "symbol", "name", "verdict", "score",
                     "last_price", "market_cap", "category", "sector"];
  const CORE_SELECT = CORE_KEYS.join(",");   // light first-paint projection (no jsonb)
  let DATA_PROMISE = null;                    // resolves once the heavy `data` blobs are merged in

  function flatten(r) {
    const base = {};
    CORE_KEYS.forEach((k) => { base[k] = r[k]; });
    return Object.assign(base, r.data || {});
  }

  function exportHeader(records) {
    const seen = new Set(CORE_KEYS);
    const extra = [];
    records.forEach((rec) =>
      Object.keys(rec).forEach((k) => { if (!seen.has(k)) { seen.add(k); extra.push(k); } }));
    return CORE_KEYS.concat(extra);
  }

  function downloadBlob(content, mime, filename) {
    const url = URL.createObjectURL(new Blob([content], { type: mime }));
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function stamp() { return new Date().toISOString().slice(0, 10); }

  async function exportCSV() {
    if (DATA_PROMISE) { try { await DATA_PROMISE; } catch (_) {} }
    const recs = VIEW.map(flatten);
    const header = exportHeader(recs);
    const esc = (v) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [header.join(",")].concat(
      recs.map((rec) => header.map((h) => esc(rec[h])).join(",")));
    downloadBlob("﻿" + lines.join("\r\n"), "text/csv;charset=utf-8", "finscan_" + stamp() + ".csv");
  }

  // Server-side branded Excel (Simple View + Full Analysis). Falls back to CSV.
  async function exportXLSX() {
    const cfg = window.FINSCAN_CONFIG || {};
    const api = cfg.API_BASE;
    const btn = $("exp-xlsx");
    if (!api || !SB) { exportCSV(); return; }
    const orig = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
    try {
      if (DATA_PROMISE) { try { await DATA_PROMISE; } catch (_) {} }
      const { data: { session } } = await SB.auth.getSession();
      const resp = await fetch(api + "/web/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + (session ? session.access_token : ""),
        },
        body: JSON.stringify({ rows: VIEW.map(flatten) }),
      });
      if (!resp.ok) throw new Error("export " + resp.status);
      const blob = await resp.blob();
      downloadBlob(blob,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "finscan_" + stamp() + ".xlsx");
    } catch (e) {
      exportCSV();   // graceful fallback so the button never dead-ends
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
    }
  }

  const val = (row, c) =>
    c.src === "data" ? (row.data ? row.data[c.k] : null) : row[c.k];

  function fmtCap(n) {
    if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
    if (n >= 1e9)  return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6)  return "$" + (n / 1e6).toFixed(2) + "M";
    return "$" + n.toLocaleString();
  }

  function fmt(v, c) {
    if (v === null || v === undefined || v === "") return "—";
    if (c.num) {
      const n = Number(v);
      if (!isFinite(n)) return "—";
      if (c.big)   return fmtCap(n);
      if (c.money) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (c.pct)   return n.toFixed(1) + "%";
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(v);
  }

  async function pageThrough(sb, columns, signal) {
    // Page through in case the universe exceeds PostgREST's per-request cap.
    const pageSize = 1000;
    let from = 0, all = [];
    while (true) {
      let q = sb
        .from("universe").select(columns)
        .order("rank", { ascending: true })
        .range(from, from + pageSize - 1);
      if (signal) q = q.abortSignal(signal);
      const { data, error } = await q;
      if (error) throw error;
      if (!data) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }

  function renderKPIs() {
    const n   = ROWS.length;
    const out = ROWS.filter((r) => r.verdict === "Outperforming").length;
    const avg = n ? ROWS.reduce((s, r) => s + (Number(r.score) || 0), 0) / n : 0;
    const top = ROWS.reduce((b, r) =>
      (Number(r.score) > Number(b.score ?? -1) ? r : b), {});
    const cards = [
      ["Stocks visible", n],
      ["Outperforming", out],
      ["Avg score", avg.toFixed(1)],
      ["Top pick", (top.symbol || "—") +
        (top.score != null ? " · " + Number(top.score).toFixed(1) : "")],
    ];
    $("kpis").innerHTML = cards.map(([l, v]) =>
      '<div class="kpi"><div class="kpi-l">' + l + '</div><div class="kpi-v">' + v + "</div></div>"
    ).join("");
  }

  function renderHead() {
    $("uhead").innerHTML = "<tr>" + activeCols().map((c) => {
      const arrow = c.k === sortKey ? (sortDir === 1 ? " ▲" : " ▼") : "";
      return '<th data-k="' + c.k + '"' + (c.num ? ' class="num"' : "") + ">" +
             c.label + arrow + "</th>";
    }).join("") + "</tr>";
    $("uhead").querySelectorAll("th").forEach((th) =>
      th.addEventListener("click", () => {
        const k = th.dataset.k;
        if (k === sortKey) sortDir *= -1;
        else { sortKey = k; sortDir = (k === "rank") ? 1 : -1; }
        renderHead(); applyFilters();
      }));
  }

  function renderTable(rows) {
    const cols = activeCols();
    $("ubody").innerHTML = rows.length ? rows.map((r) =>
      "<tr>" + cols.map((c) => {
        const v = val(r, c);
        if (c.k === "verdict")
          return '<td><span class="vbadge ' + (VERDICT_CLASS[v] || "") + '">' +
                 (v || "—") + "</span></td>";
        if (c.k === "data_flag")
          return v ? '<td><span class="note ' +
                     (v === "Limited data" ? "note-warn" : "") + '">' + v + "</span></td>"
                   : '<td class="num">—</td>';
        if (c.cat)
          return (!v || v === "-") ? '<td class="num">—</td>'
            : '<td><span class="cat ' + catClass(v) + '">' + v + "</span></td>";
        if (c.k === "symbol") return '<td class="sym">' + fmt(v, c) + "</td>";
        return "<td" + (c.num ? ' class="num"' : "") + ">" + fmt(v, c) + "</td>";
      }).join("") + "</tr>"
    ).join("")
      : '<tr><td class="empty" colspan="' + cols.length + '">No matches.</td></tr>';
  }

  function applyFilters() {
    const q    = ($("q").value || "").trim().toLowerCase();
    const cat  = $("fcat").value;
    const verd = $("fverdict").value;
    const minS = parseFloat($("fscore").value);

    let rows = ROWS.filter((r) => {
      if (cat && r.category !== cat) return false;
      if (verd && r.verdict !== verd) return false;
      if (!isNaN(minS) && (r.score == null || Number(r.score) < minS)) return false;
      if (q && !((r.symbol || "") + " " + (r.name || "")).toLowerCase().includes(q)) return false;
      return true;
    });

    const c = activeCols().find((x) => x.k === sortKey) || activeCols()[0];
    rows.sort((a, b) => {
      let av = val(a, c), bv = val(b, c);
      if (c.num) {
        av = Number(av); bv = Number(bv);
        if (!isFinite(av)) av = -Infinity;
        if (!isFinite(bv)) bv = -Infinity;
      } else {
        av = (av || "").toString().toLowerCase();
        bv = (bv || "").toString().toLowerCase();
      }
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });

    VIEW = rows;
    renderTable(rows);
    $("rowcount").textContent = rows.length + " / " + ROWS.length + " shown";
  }

  function wireFilters() {
    if (wired) return;
    const cats = Array.from(new Set(ROWS.map((r) => r.category).filter(Boolean))).sort();
    $("fcat").innerHTML = '<option value="">All categories</option>' +
      cats.map((c) => '<option value="' + c + '">' + c + "</option>").join("");
    ["q", "fcat", "fverdict", "fscore"].forEach((id) =>
      $(id).addEventListener("input", applyFilters));
    $("exp-csv").addEventListener("click", exportCSV);
    $("exp-xlsx").addEventListener("click", exportXLSX);
    document.querySelectorAll("#viewtabs .vtab").forEach((b) =>
      b.addEventListener("click", () => {
        if (b.dataset.view === viewMode) return;
        viewMode = b.dataset.view;
        document.querySelectorAll("#viewtabs .vtab").forEach((x) =>
          x.classList.toggle("active", x.dataset.view === viewMode));
        if (!activeCols().some((c) => c.k === sortKey)) { sortKey = "rank"; sortDir = 1; }
        renderHead();
        applyFilters();
      }));
    wired = true;
  }

  window.Dashboard = {
    async load(sb, opts) {
      SB = sb;
      const free = (opts && opts.mode) === "free";
      const msg = $("accessmsg");
      DATA_PROMISE = null;
      // Hard timeout so a stalled first-paint request (paused/over-quota
      // Supabase, RLS stall, flaky network) can never leave "Loading universe…"
      // spinning forever. The whole body is inside try/catch so a throw in the
      // render step surfaces an error instead of hanging too.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 45000);
      try {
        // Phase 1 — light core columns only (no heavy `data` jsonb). Paints the
        // table + KPIs near-instantly even on a 1,000+ row universe, instead of
        // blocking on multi-MB of metrics ("takes a long time to load").
        ROWS = await pageThrough(sb, CORE_SELECT, ctrl.signal);

        const dash = $("dashboard");
        if (dash) dash.removeAttribute("hidden");

        const empty = ROWS.length === 0;
        // Free mode: the picker card carries the messaging, so KPIs/filters and the
        // generic "no stocks yet" empty-state stay hidden; we just list the picks.
        $("emptystate").hidden = free ? true : !empty;
        $("kpis").hidden = free || empty;
        $("filters").hidden = free;
        $("tablecard").hidden = empty;
        if (empty) {
          if (msg) msg.innerHTML = "";
          return;
        }

        if (!free) renderKPIs();
        renderHead();
        wireFilters();
        applyFilters();
        if (msg) msg.innerHTML =
          '<span class="ok">✓ Loaded ' + ROWS.length + ' stock' + (ROWS.length === 1 ? "" : "s") +
          '.</span> <span class="muted">Loading detailed metrics…</span>';

        // Phase 2 — fetch the heavy `data` jsonb in the background, merge it in
        // by symbol, then re-render. Exports await DATA_PROMISE so they never
        // ship a half-populated sheet.
        DATA_PROMISE = (async () => {
          try {
            const blobs = await pageThrough(sb, "symbol,data", null);
            const bySym = new Map(blobs.map((b) => [b.symbol, b.data]));
            ROWS.forEach((r) => { r.data = bySym.get(r.symbol) || null; });
            applyFilters();
            if (msg) msg.innerHTML =
              '<span class="ok">✓ Loaded ' + ROWS.length + ' stock' +
              (ROWS.length === 1 ? "" : "s") + ".</span>";
          } catch (e) {
            // The core table already works; just flag that metrics didn't load.
            if (msg) msg.innerHTML =
              '<span class="ok">✓ Loaded ' + ROWS.length + ' stocks.</span> ' +
              '<span class="warn">Some metrics didn\'t load — refresh to retry.</span>';
          }
        })();
      } catch (e) {
        const why = ctrl.signal.aborted
          ? "request timed out after 45s — the data service did not respond (it may be paused, over quota, or blocked)"
          : (e && e.message ? e.message : String(e));
        if (msg) msg.innerHTML =
          '<span class="err">✗ Could not load universe: ' + why +
          '. Please refresh, or email finscan.ai@gmail.com if it persists.</span>';
      } finally {
        clearTimeout(timer);
      }
    },
    hide() {
      const d = $("dashboard");
      if (d) d.setAttribute("hidden", "");
    },
  };
})();
