# Cleaner App

A single-file mobile PWA for managing an Airbnb cleaning operation — used by our cleaner to log hours, view the checkout/check-in schedule, manage tasks, and report maintenance issues.

## Files

- `cleaner.html` — the app (frontend + logic in one file)
- `supabase-setup.sql` — database schema
- `.github/scripts/send-emails.js` — nightly email reports (daily summary + no-hours reminder)
- `.github/scripts/sync-airbnb.js` — syncs Airbnb iCal feeds into Supabase every 2 hours
- `.github/scripts/sync-calendar.js` — syncs cleaning blocks to Google Calendar every 2 hours
- `.github/workflows/` — GitHub Actions for the above

## Backend

- **Supabase** — data storage (hours, schedule, tasks, maintenance issues), credentials configured in app settings
- **Supabase Storage** — the `task-photos` bucket, for photos attached to tasks (up to 3 per task)
- **Gmail (nodemailer)** — outbound email reports
- **Google Calendar API** — cleaning block sync

## GitHub Actions secrets required

| Secret | Used by |
|---|---|
| `SUPABASE_URL` | send-emails, sync-airbnb, sync-calendar |
| `SUPABASE_SERVICE_KEY` | send-emails, sync-airbnb, sync-calendar |
| `GMAIL_USER` | send-emails, sync-airbnb |
| `GMAIL_APP_PASSWORD` | send-emails, sync-airbnb |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | sync-calendar |

## History

This repo was originally the RSSL laundry business website. It was renamed to `cleaner-app` on 2026-09-11 to keep its GitHub Actions secrets and Pages configuration, and the laundry site content was moved out to its own repo.
