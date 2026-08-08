-- Run this once in your Supabase project: SQL Editor → New Query → paste & run

CREATE TABLE IF NOT EXISTS public.hours_entries (
    id          text PRIMARY KEY,
    date        date NOT NULL,
    location    text NOT NULL CHECK (location IN ('airbnb', 'laundry', 'tamarama')),
    hours       numeric(4,1) NOT NULL,
    notes       text DEFAULT '',
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hours_entries_date_idx ON public.hours_entries (date);

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

CREATE INDEX IF NOT EXISTS airbnb_bookings_checkin_idx  ON public.airbnb_bookings (checkin);
CREATE INDEX IF NOT EXISTS airbnb_bookings_checkout_idx ON public.airbnb_bookings (checkout);

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

-- Maintenance issues table (reported by cleaner, read/resolved by all)
CREATE TABLE IF NOT EXISTS public.maintenance_issues (
    id          text PRIMARY KEY,
    location    text NOT NULL,
    description text NOT NULL DEFAULT '',
    priority    text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
    created_at  timestamptz DEFAULT now(),
    resolved    boolean NOT NULL DEFAULT false,
    notified    boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS maintenance_issues_notified_resolved_idx
    ON public.maintenance_issues (notified, resolved);

ALTER TABLE public.maintenance_issues ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_issues" ON public.maintenance_issues
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- App settings table (synced across devices — one row only)
CREATE TABLE IF NOT EXISTS public.app_settings (
    id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    cleaner_name text DEFAULT 'Our Cleaner',
    pin          text DEFAULT '1234',
    recipients   jsonb DEFAULT '[]',
    updated_at   timestamptz DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_settings" ON public.app_settings
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- Tasks table (owner-to-cleaner tasks, synced across devices)
CREATE TABLE IF NOT EXISTS public.tasks (
    id               text PRIMARY KEY,
    title            text NOT NULL,
    description      text DEFAULT '',
    priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
    due_date         date,
    added_by         text NOT NULL DEFAULT 'Owner',
    status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'completed')),
    completion_note  text DEFAULT '',
    completed_at     timestamptz,
    created_at       timestamptz DEFAULT now(),
    notified_cleaner boolean NOT NULL DEFAULT false,
    notified_owners  boolean NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS tasks_status_completed_at_idx ON public.tasks (status, completed_at);

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_tasks" ON public.tasks
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- Cleaning blocks table (cleaning schedule for the cleaner)
CREATE TABLE IF NOT EXISTS public.cleaning_blocks (
    id          text PRIMARY KEY,
    date        date NOT NULL,
    start_time  text NOT NULL DEFAULT '11:00',
    end_time    text NOT NULL DEFAULT '14:00',
    notes       text DEFAULT '',
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.cleaning_blocks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_all_cleaning" ON public.cleaning_blocks
    FOR ALL TO anon
    USING (true)
    WITH CHECK (true);

-- ── UPGRADE EXISTING INSTALLATION ────────────────────────────────────────────
-- Run these on an existing Supabase project to apply schema improvements:
--
-- CREATE INDEX IF NOT EXISTS hours_entries_date_idx ON public.hours_entries (date);
-- CREATE INDEX IF NOT EXISTS airbnb_bookings_checkin_idx  ON public.airbnb_bookings (checkin);
-- CREATE INDEX IF NOT EXISTS airbnb_bookings_checkout_idx ON public.airbnb_bookings (checkout);
-- CREATE INDEX IF NOT EXISTS maintenance_issues_notified_resolved_idx ON public.maintenance_issues (notified, resolved);
-- CREATE INDEX IF NOT EXISTS tasks_status_completed_at_idx ON public.tasks (status, completed_at);
--
-- ALTER TABLE public.hours_entries ADD CONSTRAINT location_values CHECK (location IN ('airbnb', 'laundry', 'tamarama'));
-- ALTER TABLE public.maintenance_issues ALTER COLUMN resolved SET NOT NULL, ALTER COLUMN notified SET NOT NULL;
-- ALTER TABLE public.maintenance_issues ADD CONSTRAINT priority_values CHECK (priority IN ('normal', 'urgent'));
-- ALTER TABLE public.app_settings ADD CONSTRAINT singleton CHECK (id = 1);
-- ALTER TABLE public.tasks ALTER COLUMN notified_cleaner SET NOT NULL, ALTER COLUMN notified_owners SET NOT NULL;
-- ALTER TABLE public.tasks ADD CONSTRAINT priority_values CHECK (priority IN ('normal', 'urgent'));
-- ALTER TABLE public.tasks ADD CONSTRAINT status_values  CHECK (status  IN ('open', 'completed'));
