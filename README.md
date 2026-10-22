# CYA Events Dashboard

Admin dashboard for Chingola Youth Association events. Static site (HTML/CSS/JS + supabase-js from CDN),
hosted on GitHub Pages: https://teentech-technology.github.io/cya-dashboard/ (not indexed by search engines).

## Status
Until `config.js` holds a real Supabase URL and anon key, the page shows
"Dashboard is almost ready: database not connected yet" and every action is disabled.

## Connecting the database
```bash
export SUPABASE_CYA_TOKEN=...   # Supabase personal access token
./scripts/setup.sh              # creates project cya-events, runs supabase/schema.sql,
                                # disables signups, creates admin infocya260@gmail.com,
                                # saves temp password to /workspace/cya/cya_admin_password.txt, fills config.js
git add config.js && git commit -m "Connect database" && git push
```

## Files
- `index.html`, `style.css`, `app.js`, `config.js`: the dashboard
- `supabase/schema.sql`: tables, RLS, `posters` storage bucket, seed of current website events
- `scripts/setup.sh`: one-shot Supabase setup
