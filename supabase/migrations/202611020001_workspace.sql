create extension if not exists pgcrypto with schema extensions;
create table public.invitations (
 id uuid primary key default gen_random_uuid(), email text not null check(email=lower(email)),
 expires_at timestamptz not null, accepted_at timestamptz, invited_by uuid, created_at timestamptz not null default now()
);
create unique index invitation_pending_email on public.invitations(email) where accepted_at is null;
create table public.profiles (
 id uuid primary key references auth.users(id), email text not null, name text not null default '',
 role text not null default 'seller' check(role in ('seller','admin')), suspended boolean not null default false,
 invitation_id uuid references public.invitations(id), created_at timestamptz not null default now()
);
create table public.settings(id boolean primary key default true check(id), payment_instructions text not null default 'Please contact your account administrator to arrange payment. Credits become available only after payment is verified.', invitation_hours integer not null default 24 check(invitation_hours between 1 and 168));
insert into public.settings(id) values(true);
create table public.products (
 id uuid primary key default gen_random_uuid(), name text not null check(length(name) between 1 and 160),
 category text not null default 'General', description text not null default '', specifications text not null default '',
 condition text not null default 'New', dimensions text not null default '', weight text not null default '',
 listing_title text not null default '', archived boolean not null default false, created_at timestamptz not null default now()
);
create table public.product_variants (
 id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products,
 name text not null default 'Default', sku text not null unique, wholesale_cents integer not null check(wholesale_cents>=0), resale_cents integer not null check(resale_cents>=0),
 stock integer not null default 0 check(stock>=0), committed integer not null default 0 check(committed>=0 and committed<=stock), shipped integer not null default 0 check(shipped>=0), low_stock integer not null default 5 check(low_stock>=0)
);
create table public.product_images(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products, path text not null, position integer not null default 0);
create table public.listing_assets(id uuid primary key default gen_random_uuid(), product_id uuid not null references public.products, name text not null, path text not null);
create table public.credit_requests (
 id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles, variant_id uuid not null references public.product_variants,
 quantity integer not null check(quantity between 1 and 100000), unit_cents integer not null check(unit_cents>=0),
 status text not null default 'pending_payment' check(status in ('pending_payment','payment_reported','under_review','approved','rejected','canceled')),
 notes text not null default '', decision_reason text, approved_by uuid references public.profiles, approved_at timestamptz, created_at timestamptz not null default now()
);
create table public.payment_verifications (
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique references public.credit_requests,
 verified_by uuid not null references public.profiles, paid_at timestamptz not null, method text not null check(length(trim(method))>0), notes text not null default '', verified_at timestamptz not null default now()
);
create table public.credit_balances (
 seller_id uuid not null references public.profiles, variant_id uuid not null references public.product_variants,
 issued integer not null default 0 check(issued>=0), available integer not null default 0 check(available>=0), reserved integer not null default 0 check(reserved>=0), consumed integer not null default 0 check(consumed>=0),
 primary key(seller_id,variant_id), check(issued=available+reserved+consumed)
);
create table public.fulfillment_requests (
 id uuid primary key default gen_random_uuid(), reference text not null unique default ('RL-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 seller_id uuid not null references public.profiles, idempotency_key uuid not null,
 marketplace text not null check(length(trim(marketplace)) between 1 and 100), marketplace_order_id text not null default '', notes text not null default '',
 status text not null default 'pending_review' check(status in ('pending_review','accepted','packaging','shipped','completed','rejected','canceled')),
 tracking text not null default '', shipped_at timestamptz, created_at timestamptz not null default now(), unique(seller_id,idempotency_key)
);
create table public.fulfillment_items(id uuid primary key default gen_random_uuid(), request_id uuid not null references public.fulfillment_requests, variant_id uuid not null references public.product_variants, quantity integer not null check(quantity between 1 and 100000), unique(request_id,variant_id));
create table public.shipping_labels(id uuid primary key default gen_random_uuid(), request_id uuid not null references public.fulfillment_requests, path text not null unique, name text not null);
create table public.order_status_history(id uuid primary key default gen_random_uuid(), request_id uuid not null references public.fulfillment_requests, status text not null, actor_id uuid not null references public.profiles, note text not null default '', created_at timestamptz not null default now());
create table public.credit_ledger(id uuid primary key default gen_random_uuid(), seller_id uuid not null references public.profiles, variant_id uuid not null references public.product_variants, event text not null, available_delta integer not null, reserved_delta integer not null, consumed_delta integer not null, reference_id uuid, reason text not null, actor_id uuid not null references public.profiles, created_at timestamptz not null default now());
create table public.inventory_ledger(id uuid primary key default gen_random_uuid(), variant_id uuid not null references public.product_variants, stock_delta integer not null default 0, commitment_delta integer not null default 0, reference_id uuid, reason text not null, actor_id uuid not null references public.profiles, created_at timestamptz not null default now());
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles, message text not null, read_at timestamptz, created_at timestamptz not null default now());
create table public.administrator_audit_logs(id uuid primary key default gen_random_uuid(), actor_id uuid not null references public.profiles, action text not null, reference_id uuid, details jsonb not null default '{}', created_at timestamptz not null default now());
create index credit_request_seller on public.credit_requests(seller_id,created_at desc);
create index credit_request_queue on public.credit_requests(status,created_at);
create index fulfillment_seller on public.fulfillment_requests(seller_id,created_at desc);
create index fulfillment_queue on public.fulfillment_requests(status,created_at);
create index credit_ledger_seller on public.credit_ledger(seller_id,created_at desc);
create index notifications_user on public.notifications(user_id,created_at desc);
create index fulfillment_items_variant on public.fulfillment_items(variant_id);
create index variants_product on public.product_variants(product_id);
create index labels_request on public.shipping_labels(request_id);
create index history_request on public.order_status_history(request_id,created_at);

-- These helpers never accept a user-supplied actor or role.
create function public.active_user() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id where p.id=auth.uid() and not p.suspended and u.email_confirmed_at is not null);
$$;
create function public.is_admin() returns boolean language sql stable security definer set search_path='' as $$
 select public.active_user() and exists(select 1 from public.profiles where id=auth.uid() and role='admin');
$$;
create function public.provision_invited_user() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations;
begin
 select * into inv from public.invitations where email=lower(new.email) and accepted_at is null and expires_at>now() for update;
 if not found then raise exception 'An unexpired invitation is required'; end if;
 insert into public.profiles(id,email,invitation_id) values(new.id,lower(new.email),inv.id);
 if new.email_confirmed_at is not null then update public.invitations set accepted_at=now() where id=inv.id; end if;
 return new;
end;$$;
create trigger invited_user after insert on auth.users for each row execute function public.provision_invited_user();
create function public.confirm_invitation() returns trigger language plpgsql security definer set search_path='' as $$
declare inv public.invitations;
begin
 if old.email_confirmed_at is null and new.email_confirmed_at is not null then
  select i.* into inv from public.invitations i join public.profiles p on p.invitation_id=i.id where p.id=new.id for update of i;
  if not found or inv.expires_at<=now() or inv.accepted_at is not null then raise exception 'Invitation has expired or already been used'; end if;
  update public.invitations set accepted_at=now() where id=inv.id;
 end if;return new;
end;$$;
create trigger confirmed_invitation before update of email_confirmed_at on auth.users for each row execute function public.confirm_invitation();
create function public.immutable_ledger() returns trigger language plpgsql set search_path='' as $$begin raise exception 'Audit records are immutable';end;$$;
do $$declare t text;begin foreach t in array array['credit_ledger','inventory_ledger','administrator_audit_logs','payment_verifications','order_status_history'] loop execute format('create trigger immutable before update or delete on public.%I for each row execute function public.immutable_ledger()',t);end loop;end;$$;

-- Default deny for writes. Only the narrow, authenticated RPC below mutates business data.
do $$declare t text;begin foreach t in array array['invitations','profiles','settings','products','product_variants','product_images','listing_assets','credit_requests','payment_verifications','credit_balances','fulfillment_requests','fulfillment_items','shipping_labels','order_status_history','credit_ledger','inventory_ledger','notifications','administrator_audit_logs'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
end loop;end;$$;
create policy catalog_products on public.products for select to authenticated using(public.active_user() and (not archived or public.is_admin()));
create policy catalog_variants on public.product_variants for select to authenticated using(public.active_user());
create policy catalog_images on public.product_images for select to authenticated using(public.active_user());
create policy catalog_assets on public.listing_assets for select to authenticated using(public.active_user());
create policy read_settings on public.settings for select to authenticated using(public.active_user());
create policy read_profiles on public.profiles for select to authenticated using(public.active_user() and (id=auth.uid() or public.is_admin()));
create policy read_invitations on public.invitations for select to authenticated using(public.is_admin());
do $$declare t text;begin foreach t in array array['credit_requests','credit_balances','fulfillment_requests','credit_ledger'] loop execute format('create policy own_rows on public.%I for select to authenticated using(public.active_user() and (seller_id=auth.uid() or public.is_admin()))',t);end loop;end;$$;
do $$declare t text;begin foreach t in array array['fulfillment_items','shipping_labels','order_status_history'] loop execute format('create policy own_orders on public.%I for select to authenticated using(exists(select 1 from public.fulfillment_requests f where f.id=request_id))',t);end loop;end;$$;
create policy read_payment_verifications on public.payment_verifications for select to authenticated using(public.is_admin());
create policy read_inventory_ledger on public.inventory_ledger for select to authenticated using(public.is_admin());
create policy read_admin_audit on public.administrator_audit_logs for select to authenticated using(public.is_admin());
create policy read_notifications on public.notifications for select to authenticated using(public.active_user() and user_id=auth.uid());

create function public.workspace_command(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); admin boolean:=public.is_admin(); rid uuid; vid uuid; sid uuid; q integer; delta integer; prod uuid;
 cr public.credit_requests; fr public.fulfillment_requests; v public.product_variants; b public.credit_balances;
 item public.fulfillment_items; st text; why text:=trim(coalesce(payload->>'reason','')); label jsonb; result jsonb:='{}';
begin
 if not public.active_user() then raise exception 'Your account is not active or email is not verified'; end if;
 if action in ('approve_credit','verify_payment','review_credit','reject_credit','fulfillment_status','save_product','save_variant','stock_adjust','credit_adjust','suspend_seller','save_settings','add_image','add_asset','archive_product','create_invitation') and not admin then raise exception 'Administrator access required'; end if;
 if action='request_credit' then
  vid:=(payload->>'variant_id')::uuid;q:=(payload->>'quantity')::integer;
  if q is null or q<1 or q>100000 then raise exception 'Invalid quantity';end if;
  select pv.* into v from public.product_variants pv join public.products p on p.id=pv.product_id where pv.id=vid and not p.archived;
  if not found then raise exception 'Product unavailable';end if;
  insert into public.credit_requests(seller_id,variant_id,quantity,unit_cents,notes) values(uid,vid,q,v.wholesale_cents,left(coalesce(payload->>'notes',''),2000)) returning id into rid;
  insert into public.notifications(user_id,message) values(uid,'Credit request submitted. Arrange payment with your administrator.');
  insert into public.notifications(user_id,message) select id,'New credit request awaiting payment' from public.profiles where role='admin' and not suspended;
 elsif action in ('report_payment','cancel_credit','review_credit','reject_credit','verify_payment','approve_credit') then
  rid:=(payload->>'id')::uuid;select * into cr from public.credit_requests where id=rid for update;
  if not found or (cr.seller_id<>uid and not admin) then raise exception 'Request not found';end if;
  if action='approve_credit' and cr.status='approved' then return jsonb_build_object('id',rid,'already_applied',true);end if;
  if cr.status in ('approved','rejected','canceled') then raise exception 'Request is closed';end if;
  if action='report_payment' then
   if cr.seller_id<>uid or cr.status<>'pending_payment' then raise exception 'Payment cannot be reported';end if;
   update public.credit_requests set status='payment_reported' where id=rid;
   insert into public.notifications(user_id,message) select id,'Seller reported payment. Verify before issuing credits.' from public.profiles where role='admin' and not suspended;
  elsif action='cancel_credit' then
   if cr.seller_id<>uid or exists(select 1 from public.payment_verifications where request_id=rid) then raise exception 'Contact an administrator to cancel a verified request';end if;
   update public.credit_requests set status='canceled' where id=rid;
  elsif action='review_credit' then update public.credit_requests set status='under_review' where id=rid;
  elsif action='reject_credit' then
   if why='' then raise exception 'A reason is required';end if;
   update public.credit_requests set status='rejected',decision_reason=why where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,'Credit request rejected: '||why);
  elsif action='verify_payment' then
   insert into public.payment_verifications(request_id,verified_by,paid_at,method,notes) values(rid,uid,(payload->>'paid_at')::timestamptz,trim(payload->>'method'),coalesce(payload->>'notes',''));
   update public.credit_requests set status='under_review' where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,'Payment verified. Credit approval is pending.');
  elsif action='approve_credit' then
   if not exists(select 1 from public.payment_verifications where request_id=rid) then raise exception 'Verify payment before approving credits';end if;
   select * into v from public.product_variants where id=cr.variant_id for update;
   if v.stock-v.committed<cr.quantity then raise exception 'Insufficient uncommitted inventory';end if;
   if exists(select 1 from public.profiles where id=cr.seller_id and suspended) then raise exception 'Seller is suspended';end if;
   insert into public.credit_balances(seller_id,variant_id) values(cr.seller_id,cr.variant_id) on conflict do nothing;
   update public.credit_balances set issued=issued+cr.quantity,available=available+cr.quantity where seller_id=cr.seller_id and variant_id=cr.variant_id;
   update public.product_variants set committed=committed+cr.quantity where id=cr.variant_id;
   insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id) values(cr.seller_id,cr.variant_id,'issued',cr.quantity,0,0,rid,'Verified offline payment approved',uid);
   insert into public.inventory_ledger(variant_id,commitment_delta,reference_id,reason,actor_id) values(cr.variant_id,cr.quantity,rid,'Credit commitment',uid);
   update public.credit_requests set status='approved',approved_by=uid,approved_at=now() where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,cr.quantity||' product credits approved and issued. Credits never expire.');
  end if;
 elsif action='submit_fulfillment' then
  -- Lock a seller-specific advisory key before looking up idempotency, then lock variant before balance.
  perform pg_advisory_xact_lock(hashtextextended(uid::text||coalesce(payload->>'idempotency_key',''),0));
  select id into rid from public.fulfillment_requests where seller_id=uid and idempotency_key=(payload->>'idempotency_key')::uuid;
  if found then return jsonb_build_object('id',rid,'already_applied',true);end if;
  vid:=(payload->>'variant_id')::uuid;q:=(payload->>'quantity')::integer;
  if q is null or q<1 or q>100000 then raise exception 'Invalid quantity';end if;
  select * into v from public.product_variants where id=vid for update;
  select * into b from public.credit_balances where seller_id=uid and variant_id=vid for update;
  if not found or b.available<q then raise exception 'Insufficient available credits';end if;
  if jsonb_typeof(payload->'labels') is distinct from 'array' or jsonb_array_length(payload->'labels') not between 1 and 10 then raise exception 'Upload 1–10 prepaid labels';end if;
  for label in select * from jsonb_array_elements(payload->'labels') loop
   if split_part(label->>'path','/',1)<>uid::text or not exists(select 1 from storage.objects where bucket_id='shipping-labels' and name=label->>'path') then raise exception 'Invalid shipping label';end if;
  end loop;
  insert into public.fulfillment_requests(seller_id,idempotency_key,marketplace,marketplace_order_id,notes) values(uid,(payload->>'idempotency_key')::uuid,trim(payload->>'marketplace'),left(coalesce(payload->>'marketplace_order_id',''),200),left(coalesce(payload->>'notes',''),2000)) returning id into rid;
  insert into public.fulfillment_items(request_id,variant_id,quantity) values(rid,vid,q);
  insert into public.shipping_labels(request_id,path,name) select rid,e->>'path',left(coalesce(e->>'name','Label'),200) from jsonb_array_elements(payload->'labels') e;
  update public.credit_balances set available=available-q,reserved=reserved+q where seller_id=uid and variant_id=vid;
  insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id) values(uid,vid,'reserved',-q,q,0,rid,'Fulfillment submitted',uid);
  insert into public.order_status_history(request_id,status,actor_id) values(rid,'pending_review',uid);
  insert into public.notifications(user_id,message) values(uid,'Shipping label submitted. Credits reserved for review.');
  insert into public.notifications(user_id,message) select id,'New fulfillment request' from public.profiles where role='admin' and not suspended;
 elsif action in ('fulfillment_status','cancel_fulfillment') then
  rid:=(payload->>'id')::uuid;select * into fr from public.fulfillment_requests where id=rid for update;
  if not found or (fr.seller_id<>uid and not admin) then raise exception 'Order not found';end if;
  st:=case when action='cancel_fulfillment' then 'canceled' else payload->>'status' end;
  if st=fr.status then return jsonb_build_object('id',rid,'already_applied',true);end if;
  if not ((fr.status='pending_review' and st in ('accepted','rejected','canceled')) or (fr.status='accepted' and st in ('packaging','shipped')) or (fr.status='packaging' and st='shipped') or (fr.status='shipped' and st='completed')) then raise exception 'Invalid order status transition';end if;
  if action='cancel_fulfillment' and (fr.seller_id<>uid or fr.status<>'pending_review') then raise exception 'Only pending requests can be canceled';end if;
  if st='rejected' and why='' then raise exception 'A rejection reason is required';end if;
  if st='shipped' and trim(coalesce(payload->>'tracking',''))='' then raise exception 'Tracking number is required';end if;
  for item in select * from public.fulfillment_items where request_id=rid order by variant_id loop
   perform 1 from public.product_variants where id=item.variant_id for update;
   perform 1 from public.credit_balances where seller_id=fr.seller_id and variant_id=item.variant_id for update;
   if st='accepted' then
    update public.credit_balances set reserved=reserved-item.quantity,consumed=consumed+item.quantity where seller_id=fr.seller_id and variant_id=item.variant_id;
    insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id) values(fr.seller_id,item.variant_id,'consumed',0,-item.quantity,item.quantity,rid,'Fulfillment accepted',uid);
   elsif st in ('rejected','canceled') then
    update public.credit_balances set reserved=reserved-item.quantity,available=available+item.quantity where seller_id=fr.seller_id and variant_id=item.variant_id;
    insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id) values(fr.seller_id,item.variant_id,'released',item.quantity,-item.quantity,0,rid,coalesce(nullif(why,''),'Canceled before acceptance'),uid);
   elsif st='shipped' then
    update public.product_variants set stock=stock-item.quantity,committed=committed-item.quantity,shipped=shipped+item.quantity where id=item.variant_id;
    insert into public.inventory_ledger(variant_id,stock_delta,commitment_delta,reference_id,reason,actor_id) values(item.variant_id,-item.quantity,-item.quantity,rid,'Shipment recorded',uid);
    insert into public.notifications(user_id,message) select p.id,'Low inventory: '||pv.sku from public.profiles p cross join public.product_variants pv where p.role='admin' and not p.suspended and pv.id=item.variant_id and pv.stock-pv.committed<=pv.low_stock;
   end if;
  end loop;
  update public.fulfillment_requests set status=st,tracking=case when st='shipped' then payload->>'tracking' else tracking end,shipped_at=case when st='shipped' then now() else shipped_at end where id=rid;
  insert into public.order_status_history(request_id,status,actor_id,note) values(rid,st,uid,why);
  insert into public.notifications(user_id,message) values(fr.seller_id,'Order '||fr.reference||': '||replace(st,'_',' ')||case when why<>'' then ' — '||why else '' end);
 elsif action='save_product' then
  prod:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());rid:=prod;
  insert into public.products(id,name,category,description,specifications,condition,dimensions,weight,listing_title) values(prod,trim(payload->>'name'),coalesce(payload->>'category','General'),coalesce(payload->>'description',''),coalesce(payload->>'specifications',''),coalesce(payload->>'condition','New'),coalesce(payload->>'dimensions',''),coalesce(payload->>'weight',''),coalesce(payload->>'listing_title',''))
  on conflict(id) do update set name=excluded.name,category=excluded.category,description=excluded.description,specifications=excluded.specifications,condition=excluded.condition,dimensions=excluded.dimensions,weight=excluded.weight,listing_title=excluded.listing_title;
 elsif action='save_variant' then
  vid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());rid:=vid;
  insert into public.product_variants(id,product_id,name,sku,wholesale_cents,resale_cents,low_stock) values(vid,(payload->>'product_id')::uuid,trim(payload->>'name'),trim(payload->>'sku'),(payload->>'wholesale_cents')::integer,(payload->>'resale_cents')::integer,coalesce((payload->>'low_stock')::integer,5))
  on conflict(id) do update set name=excluded.name,sku=excluded.sku,wholesale_cents=excluded.wholesale_cents,resale_cents=excluded.resale_cents,low_stock=excluded.low_stock;
 elsif action='archive_product' then rid:=(payload->>'id')::uuid;update public.products set archived=coalesce((payload->>'archived')::boolean,true) where id=rid;
 elsif action in ('add_image','add_asset') then
  rid:=(payload->>'product_id')::uuid;
  if not exists(select 1 from storage.objects where bucket_id='product-assets' and name=payload->>'path') then raise exception 'Upload the file first';end if;
  if action='add_image' then insert into public.product_images(product_id,path) values(rid,payload->>'path');
  else insert into public.listing_assets(product_id,path,name) values(rid,payload->>'path',payload->>'name');end if;
 elsif action='stock_adjust' then
  vid:=(payload->>'variant_id')::uuid;delta:=(payload->>'delta')::integer;rid:=vid;
  if delta is null or delta=0 or why='' then raise exception 'A nonzero adjustment and reason are required';end if;
  update public.product_variants set stock=stock+delta where id=vid;
  if not found then raise exception 'Variant not found';end if;
  insert into public.inventory_ledger(variant_id,stock_delta,reason,actor_id) values(vid,delta,why,uid);
 elsif action='credit_adjust' then
  vid:=(payload->>'variant_id')::uuid;sid:=(payload->>'seller_id')::uuid;delta:=(payload->>'delta')::integer;rid:=vid;
  if why='' or delta is null or delta=0 then raise exception 'A nonzero adjustment and reason are required';end if;
  perform 1 from public.product_variants where id=vid for update;
  insert into public.credit_balances(seller_id,variant_id) values(sid,vid) on conflict do nothing;
  update public.credit_balances set available=available+delta,issued=issued+delta where seller_id=sid and variant_id=vid;
  update public.product_variants set committed=committed+delta where id=vid;
  insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reason,actor_id) values(sid,vid,'adjustment',delta,0,0,why,uid);
  insert into public.inventory_ledger(variant_id,commitment_delta,reason,actor_id) values(vid,delta,why,uid);
 elsif action='suspend_seller' then
  rid:=(payload->>'id')::uuid;if rid=uid then raise exception 'You cannot suspend yourself';end if;
  if why='' then raise exception 'A reason is required';end if;
  update public.profiles set suspended=(payload->>'suspended')::boolean where id=rid and role='seller';
 elsif action='save_settings' then update public.settings set payment_instructions=payload->>'payment_instructions',invitation_hours=(payload->>'invitation_hours')::integer where id;
 elsif action='save_profile' then update public.profiles set name=left(trim(payload->>'name'),160) where id=uid;
 elsif action='read_notification' then update public.notifications set read_at=now() where id=(payload->>'id')::uuid and user_id=uid;
 elsif action='create_invitation' then
  -- Called by the Edge Function using the original administrator JWT.
  if exists(select 1 from public.profiles where email=lower(trim(payload->>'email'))) then raise exception 'This email already has an account';end if;
  insert into public.invitations(email,expires_at,invited_by) values(lower(trim(payload->>'email')),now()+make_interval(hours=>(select invitation_hours from public.settings)),uid) returning id into rid;
 else raise exception 'Unknown action';end if;
 if admin then insert into public.administrator_audit_logs(actor_id,action,reference_id,details) values(uid,action,rid,jsonb_build_object('reason',why));end if;
 return jsonb_build_object('id',rid);
end;$$;

revoke execute on all functions in schema public from public,anon,authenticated;
grant execute on function public.active_user(),public.is_admin(),public.workspace_command(text,jsonb) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
 ('shipping-labels','shipping-labels',false,10485760,array['application/pdf','image/png','image/jpeg']),
 ('product-assets','product-assets',false,10485760,array['application/pdf','image/png','image/jpeg','image/webp']);
create policy upload_labels on storage.objects for insert to authenticated with check(bucket_id='shipping-labels' and public.active_user() and (storage.foldername(name))[1]=auth.uid()::text);
create policy read_labels on storage.objects for select to authenticated using(bucket_id='shipping-labels' and public.active_user() and ((storage.foldername(name))[1]=auth.uid()::text or (public.is_admin() and exists(select 1 from public.shipping_labels sl where sl.path=storage.objects.name))));
create policy upload_assets on storage.objects for insert to authenticated with check(bucket_id='product-assets' and public.is_admin());
create policy read_assets on storage.objects for select to authenticated using(bucket_id='product-assets' and public.active_user());
