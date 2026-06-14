// FinScan Web App — public config.
// The anon key is PUBLIC by design (RLS protects the data). Safe to commit.
// NEVER put the service_role key or any Stripe secret here — those live on Railway only.
//
// Values from Supabase → Settings → API (publishable key, safe in browser).
window.FINSCAN_CONFIG = {
  SUPABASE_URL: "https://vwcbaqdlnyxwxaxovxnd.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_5C7EX-oKpfPJsj3bBjk0Fg_TIe_q4iJ",
  // Railway Flask server (Stripe checkout + webhooks).
  API_BASE: "https://web-production-01031.up.railway.app",
};
