create table if not exists public.user_links (
  supabase_user_id uuid primary key references auth.users(id) on delete cascade,
  telegram_user_id text unique not null,
  linked_at timestamptz default now()
);

create table if not exists public.link_codes (
  code text primary key,
  supabase_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create index if not exists idx_link_codes_expires on public.link_codes (expires_at);

alter table public.link_codes enable row level security;
alter table public.user_links enable row level security;

drop policy if exists link_codes_owner_select on public.link_codes;
create policy link_codes_owner_select
  on public.link_codes for select
  using (supabase_user_id = auth.uid());

drop policy if exists link_codes_owner_insert on public.link_codes;
create policy link_codes_owner_insert
  on public.link_codes for insert
  with check (supabase_user_id = auth.uid());

drop policy if exists user_links_owner_select on public.user_links;
create policy user_links_owner_select
  on public.user_links for select
  using (supabase_user_id = auth.uid());
