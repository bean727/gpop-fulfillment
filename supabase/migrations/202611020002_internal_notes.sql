create table public.fulfillment_internal_notes (
 id uuid primary key default gen_random_uuid(), request_id uuid not null references public.fulfillment_requests,
 actor_id uuid not null references public.profiles, note text not null check(length(trim(note)) between 1 and 4000), created_at timestamptz not null default now()
);
create index internal_notes_request on public.fulfillment_internal_notes(request_id,created_at);
alter table public.fulfillment_internal_notes enable row level security;
revoke all on public.fulfillment_internal_notes from anon,authenticated;
grant select on public.fulfillment_internal_notes to authenticated;
create policy admin_internal_notes on public.fulfillment_internal_notes for select to authenticated using(public.is_admin());
create trigger immutable before update or delete on public.fulfillment_internal_notes for each row execute function public.immutable_ledger();
create function public.add_internal_note(request uuid,note text) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.is_admin() then raise exception 'Administrator access required';end if;
 insert into public.fulfillment_internal_notes(request_id,actor_id,note) values(request,auth.uid(),trim(note));
 insert into public.administrator_audit_logs(actor_id,action,reference_id) values(auth.uid(),'fulfillment_internal_note',request);
end;$$;
revoke execute on function public.add_internal_note(uuid,text) from public,anon;
grant execute on function public.add_internal_note(uuid,text) to authenticated;
