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
  const COLS = [
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
    { k: "upside",        label: "Upside %", num: true, src: "data", pct: true },
    { k: "category",      label: "Category",      src: "row" },
  ];

  // Categorical badge colour by sentiment (no buy/sell wording).
  const CAT_GOOD = new Set(["Very Cheap", "Cheap", "High Growth", "Growing",
    "Highly Profitable", "Profitable", "Very Healthy", "Healthy"]);
  const CAT_BAD = new Set(["Expensive", "Very Expensive", "Declining",
    "Loss-Making", "High Debt"]);
  const catClass = (v) =>
    CAT_GOOD.has(v) ? "cat-good" : CAT_BAD.has(v) ? "cat-bad" : "cat-mid";

  let ROWS = [];
  let VIEW = [];                       // current filtered + sorted rows (for export)
  let sortKey = "rank", sortDir = 1;   // 1 asc, -1 desc
  let wired = false;

  // Core columns first, then every field from the data jsonb (full dataset).
  const CORE_KEYS = ["rank", "symbol", "name", "verdict", "score",
                     "last_price", "market_cap", "category", "sector"];

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

  function exportCSV() {
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

  function exportXLSX() {
    if (!window.XLSX) { exportCSV(); return; }   // graceful fallback
    const recs = VIEW.map(flatten);
    const header = exportHeader(recs);
    const ws = XLSX.utils.json_to_sheet(recs, { header });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FinScan");
    XLSX.writeFile(wb, "finscan_" + stamp() + ".xlsx");
  }

  const val = (row, c) =>
    c.src === "data" ? (row.data ? row.data[c.k] : null) : row[c.k];

  function fmt(v, c) {
    if (v === null || v === undefined || v === "") return "—";
    if (c.num) {
      const n = Number(v);
      if (!isFinite(n)) return "—";
      if (c.money) return "$" + n.toLocaleString(undefined, { maximumFractionDigits: 2 });
      if (c.pct)   return n.toFixed(1) + "%";
      return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    }
    return String(v);
  }

  async function fetchAll(sb) {
    // Page through in case the universe exceeds PostgREST's per-request cap.
    const page = 1000;
    let from = 0, all = [];
    while (true) {
      const { data, error } = await sb
        .from("universe").select("*")
        .order("rank", { ascending: true })
        .range(from, from + page - 1);
      if (error) throw error;
      all = all.concat(data);
      if (data.length < page) break;
      from += page;
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
    $("uhead").innerHTML = "<tr>" + COLS.map((c) => {
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
    $("ubody").innerHTML = rows.length ? rows.map((r) =>
      "<tr>" + COLS.map((c) => {
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
      : '<tr><td class="empty" colspan="' + COLS.length + '">No matches.</td></tr>';
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

    const c = COLS.find((x) => x.k === sortKey);
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
    wired = true;
  }

  window.Dashboard = {
    async load(sb, opts) {
      const free = (opts && opts.mode) === "free";
      const msg = $("accessmsg");
      try {
        ROWS = await fetchAll(sb);
      } catch (e) {
        if (msg) msg.innerHTML = '<span class="err">✗ Could not load universe: ' + e.message + "</span>";
        return;
      }
      $("dashboard").removeAttribute("hidden");

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

      if (msg) msg.innerHTML =
        '<span class="ok">✓ Loaded ' + ROWS.length + ' stock' + (ROWS.length === 1 ? "" : "s") + ".</span>";
      if (!free) renderKPIs();
      renderHead();
      wireFilters();
      applyFilters();
    },
    hide() {
      const d = $("dashboard");
      if (d) d.setAttribute("hidden", "");
    },
  };
})();
