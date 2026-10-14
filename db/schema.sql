-- Art of Eskeml business system. Safe to run more than once (npm run db:setup).
create extension if not exists pgcrypto;

create table if not exists settings (key text primary key, value jsonb not null);

create table if not exists pieces (
  id uuid primary key default gen_random_uuid(),
  sku text unique not null,
  name text not null default '',
  category text not null default '',
  metal text not null default 'gold',          -- gold, silver, platinum
  purity text not null default '22K',          -- 22K, 18K, 925 ...
  gross_weight_g numeric,
  net_weight_g numeric,
  making_type text not null default 'percent' check (making_type in ('per_gram','percent','flat')),
  making_value numeric not null default 0,
  stone_cost numeric not null default 0,
  stock int not null default 1,
  status text not null default 'active' check (status in ('active','made_to_order','sold','hidden')),
  photos text[] not null default '{}',
  reels text[] not null default '{}',
  tagline text, caption text, hashtags text[] not null default '{}',
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text,
  phone text unique,                            -- digits with country code, e.g. 919876543210
  instagram_id text unique,                     -- Instagram-scoped user id from the webhook
  instagram_handle text,
  email text, city text, state text,
  birthday date, anniversary date,
  consent_marketing boolean not null default false,
  referral_code text unique,
  referred_by uuid references customers,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers,
  channel text not null check (channel in ('whatsapp','instagram','web','call','walk_in','referral','exhibition')),
  status text not null default 'new' check (status in ('new','talking','quoted','booked','won','lost')),
  interest text, budget numeric, occasion text, needed_by date,
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists leads_status_idx on leads (status, last_message_at desc);

create table if not exists messages (
  id bigserial primary key,
  lead_id uuid not null references leads,
  direction text not null check (direction in ('in','out')),
  channel text not null,
  external_id text unique,
  body text not null default '',
  media text[] not null default '{}',
  status text not null default 'ok',            -- ok, failed, manual (sent by the owner from their phone)
  at timestamptz not null default now()
);
create index if not exists messages_lead_idx on messages (lead_id, at);

create table if not exists drafts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads,
  kind text not null check (kind in ('reply','quote','booking','followup')),
  body text not null,
  piece_skus text[] not null default '{}',
  quote jsonb,
  booking_at timestamptz,
  needs_approval boolean not null default true,
  reason text,
  author text not null default 'assistant',     -- assistant (free rules) or claude
  status text not null default 'pending' check (status in ('pending','sent','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists drafts_pending_idx on drafts (status, created_at);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads,
  customer_id uuid references customers,
  starts_at timestamptz not null,
  kind text not null default 'video_call' check (kind in ('video_call','store_visit')),
  status text not null default 'booked' check (status in ('booked','done','cancelled')),
  created_at timestamptz not null default now()
);

create sequence if not exists order_no_seq;
create sequence if not exists invoice_no_seq;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  customer_id uuid not null references customers,
  lead_id uuid references leads,
  type text not null default 'custom' check (type in ('ready','custom')),
  stage text not null default 'design_approved',
  total numeric not null default 0,
  advance_due numeric not null default 0,
  paid numeric not null default 0,
  huid text,
  tracking_url text,
  due_date date,
  notes text,
  pay_token text not null default encode(gen_random_bytes(12), 'hex'),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create table if not exists order_items (
  id bigserial primary key,
  order_id uuid not null references orders on delete cascade,
  piece_id uuid references pieces,
  description text not null,
  qty int not null default 1,
  breakup jsonb not null                        -- output of lib/pricing.js, per unit
);

create table if not exists order_events (
  id bigserial primary key,
  order_id uuid not null references orders on delete cascade,
  stage text not null,
  note text, photo text,
  customer_notified text,                       -- 'whatsapp', 'instagram', 'link' (owner sends) or null
  at timestamptz not null default now()
);

create table if not exists payments (
  id bigserial primary key,
  order_id uuid not null references orders,
  amount numeric not null,
  method text not null default 'upi',           -- upi, cash, card, bank
  reference text,
  at timestamptz not null default now()
);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique not null,
  order_id uuid unique not null references orders,
  taxable numeric not null, cgst numeric not null, sgst numeric not null, igst numeric not null,
  total numeric not null,
  pdf bytea not null,
  created_at timestamptz not null default now()
);

create table if not exists payables (
  id uuid primary key default gen_random_uuid(),
  party text not null,                          -- karigar, supplier, rent...
  amount numeric not null,
  due_date date not null,
  paid boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists metal_rates (
  day date not null,
  metal text not null,
  purity text not null,
  rate_per_g numeric not null,
  primary key (day, metal, purity)
);

-- Things the daily job already did, so nothing is sent twice.
create table if not exists reminders (
  kind text not null,
  ref text not null,
  customer_id uuid references customers,
  body text not null default '',
  channel text,                                 -- whatsapp (sent free in the 24h window) or link (owner sends)
  done boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (kind, ref)
);
