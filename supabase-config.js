// ==========================================================
// Fill these in from Supabase → Project Settings → API.
// The anon/public key is safe to expose in frontend code —
// that's what it's for. Never put the service_role key here.
// ==========================================================
const SUPABASE_URL = "https://bfxlvdzuedjlfzannpgy.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_PH0Gi9-wgsSd8tSBiii99g_ZigrvN6r";
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
