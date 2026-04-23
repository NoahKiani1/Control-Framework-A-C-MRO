alter table public.extra_actions enable row level security;

drop policy if exists "extra_actions_select_all" on public.extra_actions;
create policy "extra_actions_select_all"
on public.extra_actions
for select
to anon, authenticated
using (true);

drop policy if exists "extra_actions_insert_all" on public.extra_actions;
create policy "extra_actions_insert_all"
on public.extra_actions
for insert
to anon, authenticated
with check (true);

drop policy if exists "extra_actions_update_all" on public.extra_actions;
create policy "extra_actions_update_all"
on public.extra_actions
for update
to anon, authenticated
using (true)
with check (true);

drop policy if exists "extra_actions_delete_all" on public.extra_actions;
create policy "extra_actions_delete_all"
on public.extra_actions
for delete
to anon, authenticated
using (true);
