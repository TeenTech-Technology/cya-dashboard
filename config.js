/* CYA dashboard settings.
   scripts/setup.sh fills these in automatically once the database exists.
   The anon key is safe to be public: Row Level Security protects the data. */
window.CYA_CONFIG = {
  SUPABASE_URL: "YOUR_SUPABASE_URL",
  SUPABASE_ANON_KEY: "YOUR_SUPABASE_ANON_KEY",
  POSTERS_BUCKET: "posters"
};
