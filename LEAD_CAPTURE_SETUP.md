# AI Readiness Lead Capture Setup

Add these environment variables to the Vercel project for Production, Preview, and Development as appropriate:

- `RESEND_API_KEY` — Resend API key used to email new leads.
- `LEAD_NOTIFICATION_EMAIL` — destination inbox, for example `nick@colossalai.co`.
- `LEAD_FROM_EMAIL` — verified Resend sender, for example `Colossal Website <leads@colossalai.co>`.
- `SUPABASE_URL` — Supabase project URL.
- `SUPABASE_SERVICE_ROLE_KEY` — server-only Supabase service-role key.

Run `supabase-assessment-leads.sql` in the Supabase SQL editor before enabling database storage.

The serverless endpoint will still email leads when Supabase is not configured, and will still save leads when Resend is not configured. At least one destination must be configured.
