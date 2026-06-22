-- ============================================================
-- M.A.M.M.B.A AI Sales Agent — Supabase Schema
-- Run this in your Supabase SQL editor (Dashboard → SQL Editor)
-- ============================================================

-- LEADS TABLE
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  title         text,
  company       text not null,
  phone         text,
  email         text,
  county        text check (county in ('Broward','Miami-Dade','Palm Beach')),
  tier          text,
  industry      text,
  status        text default 'New' check (status in (
                  'New','RVM Sent','Called','Texted','Emailed',
                  'Engaged','Proposal Sent','Negotiating','Closed Won','Closed Lost','On Hold'
                )),
  priority      text default 'Medium' check (priority in ('High','Medium','Low')),
  monthly_value text,
  touches       int default 0,
  last_contact  timestamptz,
  next_followup timestamptz,
  notes         text,
  sequence_step int default 0,
  sequence_paused boolean default false,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- ACTIVITY LOG TABLE
create table if not exists activity_log (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid references leads(id) on delete cascade,
  channel     text check (channel in ('call','rvm','sms','email','note')),
  direction   text default 'outbound' check (direction in ('outbound','inbound')),
  summary     text not null,
  body        text,
  result      text,
  duration_s  int,
  created_at  timestamptz default now()
);

-- CAMPAIGNS TABLE
create table if not exists campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  type        text check (type in ('rvm','sms','email','call','full_sequence')),
  status      text default 'draft' check (status in ('draft','running','paused','complete')),
  target      text,
  sent_count  int default 0,
  reply_count int default 0,
  created_at  timestamptz default now()
);

-- SETTINGS TABLE
create table if not exists settings (
  key   text primary key,
  value text
);

-- Insert default settings
insert into settings (key, value) values
  ('agent_name',    'M.A.M.M.B.A Enterprises LLC'),
  ('from_phone',    ''),
  ('from_email',    ''),
  ('tagline',       'South Florida''s premier medical courier'),
  ('agent_active',  'true'),
  ('seq_delay_days','2'),
  ('seq_calls',     '3'),
  ('seq_stop_reply','true')
on conflict (key) do nothing;

-- INDEXES
create index if not exists leads_status_idx   on leads(status);
create index if not exists leads_county_idx   on leads(county);
create index if not exists leads_followup_idx on leads(next_followup);
create index if not exists activity_lead_idx  on activity_log(lead_id);

-- AUTO-UPDATE updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

create trigger leads_updated_at
  before update on leads
  for each row execute function update_updated_at();

-- ROW LEVEL SECURITY (enable for production)
alter table leads        enable row level security;
alter table activity_log enable row level security;
alter table campaigns    enable row level security;
alter table settings     enable row level security;

-- Allow service role full access (used by Next.js API routes)
create policy "service_role_leads"    on leads        for all using (true);
create policy "service_role_activity" on activity_log for all using (true);
create policy "service_role_campaigns"on campaigns    for all using (true);
create policy "service_role_settings" on settings     for all using (true);

-- Add preferred_language to leads (run this if upgrading an existing install)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_language text DEFAULT 'auto';
