// FinScan Web App — Phase 1.
// Block 1: init Supabase client + connection test.
// Block 3: magic-link auth + RLS-gated access state.
// Later blocks fill the data table (5) and Stripe gating (4).

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    status: $("status"), who: $("who"), signout: $("signout"),
    auth: $("auth"), authform: $("authform"), email: $("email"),
    sendlink: $("sendlink"), authmsg: $("authmsg"),
    account: $("account"), planline: $("planline"),
    accessmsg: $("accessmsg"), hint: $("hint"), bootcard: $("bootcard"),
    upgrade: $("upgrade"),
  };

  const show = (el) => el && el.removeAttribute("hidden");
  const hide = (el) => el && el.setAttribute("hidden", "");
  const set = (el, html) => { if (el) el.innerHTML = html; };

  const cfg = window.FINSCAN_CONFIG || {};
  const configured =
    cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes("YOUR-PROJECT") &&
    cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes("YOUR-ANON");

  if (!window.supabase) {
    set(els.status, '<span class="err">✗ Supabase client failed to load (CDN blocked?).</span>');
    return;
  }
  if (!configured) {
    set(els.status,
      '<span class="warn">⚠ Supabase not configured.</span> Paste your Project URL + anon key into <b>app/config.js</b>.');
    els.who.textContent = "not connected";
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  window.sb = sb; // handy during dev

  // ── Magic-link login ───────────────────────────────────────────────────────
  els.authform.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = els.email.value.trim();
    if (!email) return;
    els.sendlink.disabled = true;
    show(els.authmsg);
    set(els.authmsg, "Sending…");
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin + window.location.pathname },
    });
    els.sendlink.disabled = false;
    if (error) {
      set(els.authmsg, '<span class="err">✗ ' + error.message + "</span>");
    } else {
      set(els.authmsg,
        '<span class="ok">✓ Check your inbox.</span> Click the link in the email to sign in. ' +
        "You can close this tab.");
    }
  });

  els.signout.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  // ── Stripe checkout (Block 4) ──────────────────────────────────────────────
  async function startCheckout(plan, btn) {
    const api = cfg.API_BASE;
    if (!api) { alert("API_BASE not set in config.js"); return; }
    btn.disabled = true;
    const orig = btn.textContent;
    btn.textContent = "Redirecting…";
    try {
      const { data: { session } } = await sb.auth.getSession();
      const resp = await fetch(api + "/web/create-checkout", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + session.access_token,
        },
        body: JSON.stringify({ plan }),
      });
      const j = await resp.json();
      if (j.url) { window.location.href = j.url; return; }
      throw new Error(j.error || "checkout failed");
    } catch (e) {
      set(els.hint, '<span class="err">✗ ' + e.message + "</span>");
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  els.upgrade.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-plan]");
    if (btn) startCheckout(btn.dataset.plan, btn);
  });

  // ── Render per session ─────────────────────────────────────────────────────
  async function render(session) {
    if (!session) {
      els.who.textContent = "guest";
      hide(els.signout); hide(els.account); show(els.auth);
      hide(els.bootcard);
      return;
    }

    els.who.textContent = session.user.email || "signed in";
    show(els.signout); hide(els.auth); show(els.account); hide(els.bootcard);

    // Plan: read own profile (RLS allows own row only).
    const { data: prof } = await sb
      .from("profiles").select("subscription_active, subscription_plan")
      .eq("id", session.user.id).maybeSingle();
    const active = prof && prof.subscription_active;
    set(els.planline, active
      ? '<span class="ok">Active subscriber</span> — full universe unlocked.'
      : 'Free preview — upgrade to unlock the full universe.');
    if (active) hide(els.upgrade); else show(els.upgrade);

    // Prove RLS: how many rows can this user actually read?
    const { count, error } = await sb
      .from("universe").select("*", { count: "exact", head: true });
    if (error) {
      set(els.accessmsg, '<span class="warn">⚠ ' + error.message + "</span>");
      els.hint.textContent = "";
      return;
    }
    set(els.accessmsg,
      '<span class="ok">✓ You can view <b>' + count + '</b> stock' + (count === 1 ? "" : "s") + '.</span>');
    els.hint.textContent = active
      ? "The sortable universe table lands here in Block 5."
      : "Free tier shows the top 3. Stripe checkout → full access comes in Block 4.";
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  sb.auth.getSession().then(({ data: { session } }) => render(session));
  sb.auth.onAuthStateChange((_event, session) => render(session));

  // TODO Block 5: fetch universe rows → sortable/filterable table + KPI cards.
  // TODO Block 6: "Export Excel" → Railway endpoint with current filter.
})();
