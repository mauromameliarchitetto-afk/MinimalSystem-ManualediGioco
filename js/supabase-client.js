/* Client Supabase (account/campagne/cloud). Nessun bundler in questo
   progetto (PWA statica + Capacitor): la libreria e' vendorizzata in
   js/vendor/supabase.js come le altre dipendenze (pdf.js), non via npm.
   L'URL e la chiave "publishable" sono pubblici per progetto (equivalenti
   alla vecchia "anon key"): sono pensati per stare nel client, le regole
   di accesso vere sono lato server nelle policy RLS di supabase/migrations. */
const SUPABASE_URL = 'https://gaoaipykiavweeeziwnd.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_0rjznlvnGlerTGCV3QepJQ_t3--sUcv';

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false
  }
});
