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
    welcomebanner: $("welcomebanner"), welcometext: $("welcometext"),
  };

  // Post-checkout return: getfinscan.com/app/?welcome=1
  let isWelcome = new URLSearchParams(location.search).has("welcome");
  function clearWelcomeParam() {
    if (isWelcome) { history.replaceState(null, "", location.pathname); isWelcome = false; }
  }

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

  async function isActive(userId) {
    const { data } = await sb
      .from("profiles").select("subscription_active")
      .eq("id", userId).maybeSingle();
    return !!(data && data.subscription_active);
  }

  // After Stripe checkout the webhook flips subscription_active asynchronously,
  // so on ?welcome the profile may still read inactive for a few seconds. Poll.
  async function handleWelcome(session, alreadyActive) {
    show(els.welcomebanner);
    if (alreadyActive) {
      set(els.welcometext, "🎉 You're in — your subscription is active. Full universe unlocked.");
      clearWelcomeParam();
      return;
    }
    set(els.welcometext, "Activating your subscription… this can take a few seconds.");
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 2500));
      if (await isActive(session.user.id)) {
        clearWelcomeParam();
        render(session);   // re-render: planline + full universe
        return;
      }
    }
    set(els.welcometext,
      "Payment received. Activation is taking longer than usual — refresh in a minute, " +
      "or email finscan.ai@gmail.com if it persists.");
  }

  // ── Render per session ─────────────────────────────────────────────────────
  async function render(session) {
    if (!session) {
      els.who.textContent = "guest";
      hide(els.signout); hide(els.account); show(els.auth); hide(els.bootcard);
      hide(els.welcomebanner);
      window.Dashboard && window.Dashboard.hide();
      return;
    }

    els.who.textContent = session.user.email || "signed in";
    show(els.signout); hide(els.auth); show(els.account); hide(els.bootcard);

    const active = await isActive(session.user.id);
    set(els.planline, active
      ? '<span class="ok">Active subscriber</span> — full universe unlocked.'
      : 'Free preview — top 3 only. Upgrade to unlock the full universe.');
    if (active) hide(els.upgrade); else show(els.upgrade);
    els.hint.textContent = active ? "" : "Free tier shows the 3 highest-scoring stocks.";

    // Universe table (RLS decides how many rows come back).
    set(els.accessmsg, "Loading universe…");
    window.Dashboard.load(sb);

    if (isWelcome) handleWelcome(session, active);
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  sb.auth.getSession().then(({ data: { session } }) => render(session));
  sb.auth.onAuthStateChange((_event, session) => render(session));

})();
