-- Run this once in your Supabase project: SQL Editor → New Query → paste & run

CREATE TABLE IF NOT EXISTS public.hours_entries (
    id          text PRIMARY KEY,
    date        date NOT NULL,
    location    text NOT NULL,
    hours       numeric(4,1) NOT NULL,
    notes       text DEFAULT '',
    created_at  timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.hours_entries ENABLE ROW LEVEL SECURITY;

-- Allow the anon key (used by the phone app) to read and write
CREATE POLICY "app_all" ON public.hours_entries
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- Airbnb bookings table (written by GitHub Actions, read by the app)
CREATE TABLE IF NOT EXISTS public.airbnb_bookings (
    id          text PRIMARY KEY,
    room        text NOT NULL,
    checkin     date NOT NULL,
    checkout    date NOT NULL,
    summary     text DEFAULT '',
    fetched_at  timestamptz DEFAULT now()
);

ALTER TABLE public.airbnb_bookings ENABLE ROW LEVEL SECURITY;

-- App (anon key) can read bookings
CREATE POLICY "app_read" ON public.airbnb_bookings
    FOR SELECT TO anon
    USING (true);

-- Service role (GitHub Actions) can write bookings
CREATE POLICY "service_write" ON public.airbnb_bookings
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);

-- Maintenance issues table (written by app, read by GitHub Actions for alert emails)
CREATE TABLE IF NOT EXISTS public.maintenance_issues (
    id          text PRIMARY KEY,
    location    text NOT NULL,
    description text NOT NULL,
    priority    text NOT NULL DEFAULT 'normal',
    created_at  timestamptz DEFAULT now(),
    resolved    boolean DEFAULT false,
    notified    boolean DEFAULT false
);

ALTER TABLE public.maintenance_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_issues" ON public.maintenance_issues
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- App settings table (shared across devices via Supabase)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id           integer PRIMARY KEY DEFAULT 1,
    cleaner_name text,
    pin          text,
    recipients   jsonb,
    updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_settings" ON public.app_settings
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);
