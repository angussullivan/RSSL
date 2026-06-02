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
