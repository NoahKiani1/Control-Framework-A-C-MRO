create table if not exists public.shop_wall_settings (
  id text primary key default 'default',
  aviation_news_enabled boolean not null default false,
  updated_at timestamp with time zone not null default timezone('utc'::text, now()),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint shop_wall_settings_singleton check (id = 'default')
);

insert into public.shop_wall_settings (id, aviation_news_enabled)
values ('default', false)
on conflict (id) do nothing;

alter table public.shop_wall_settings enable row level security;
-- noah was hier
