// FinScan Web App — Phase 1 scaffold.
// Block 1: init Supabase client, verify connection, stub auth + data.
// Later blocks fill the TODOs.

(function () {
  "use strict";

  const statusEl = document.getElementById("status");
  const whoEl = document.getElementById("who");

  function line(html) { statusEl.innerHTML = html; }

  const cfg = window.FINSCAN_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL &&
    !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY &&
    !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");

  if (!window.supabase) {
    line('<span class="err">✗ Supabase client failed to load (CDN blocked?).</span>');
    return;
  }

  if (!configured) {
    line(
      '<span class="warn">⚠ Supabase not configured yet.</span><br>' +
      'Paste your Project URL + anon key into <b>app/config.js</b> (see ARCHITECTURE.md → setup checklist).'
    );
    whoEl.textContent = "not connected";
    return;
  }

  // Client is ready. RLS on the server side is what actually protects data.
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  window.sb = sb; // handy during dev

  async function boot() {
    line('<span class="ok">✓ Supabase client initialised.</span> Checking session…');

    // ── Auth (wired in Block 3) ───────────────────────────────────────────────
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      whoEl.textContent = session.user.email || "signed in";
    } else {
      whoEl.textContent = "guest";
    }

    // ── Connection smoke-test ─────────────────────────────────────────────────
    // The `universe` table doesn't exist until Block 2 — a "relation does not
    // exist" error here still proves we reached Supabase. Anything else = config issue.
    const { error } = await sb.from("universe").select("symbol").limit(1);
    if (!error) {
      line('<span class="ok">✓ Connected — `universe` table reachable.</span> Ready for Block 5 (table UI).');
    } else if (/does not exist|relation/i.test(error.message)) {
      line('<span class="ok">✓ Connected to Supabase.</span> `universe` table not created yet — that\'s Block 2.');
    } else {
      line('<span class="warn">⚠ Reached Supabase but query failed:</span> ' + error.message);
    }
  }

  boot().catch((e) =>
    line('<span class="err">✗ Unexpected error: ' + (e && e.message) + '</span>')
  );

  // TODO Block 3: signIn(email) via magic link; onAuthStateChange → re-render.
  // TODO Block 5: fetch universe rows → render sortable/filterable table + KPI cards.
  // TODO Block 6: "Export Excel" → call Railway endpoint with current filter.
})();
