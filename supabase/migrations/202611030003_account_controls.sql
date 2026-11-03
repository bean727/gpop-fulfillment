-- Existing project update. Apply the order-management update first (included in the bundled file).
begin;
alter table public.credit_requests add column if not exists outstanding_cents integer;
update public.credit_requests set outstanding_cents=case when status='approved' and payment_status<>'verified' then quantity*unit_cents else 0 end where outstanding_cents is null;
alter table public.credit_requests alter column outstanding_cents set default 0, alter column outstanding_cents set not null;
do $$ begin if not exists(select 1 from pg_constraint where conname='credit_request_outstanding_nonnegative' and conrelid='public.credit_requests'::regclass) then alter table public.credit_requests add constraint credit_request_outstanding_nonnegative check(outstanding_cents>=0);end if;end $$;
create table if not exists public.seller_billing(seller_id uuid primary key references public.profiles,manual_cents integer not null default 0 check(manual_cents>=0));
alter table public.seller_billing enable row level security;
revoke all on public.seller_billing from public,anon,authenticated;
grant select on public.seller_billing to authenticated;
drop policy if exists billing_owner on public.seller_billing;
create policy billing_owner on public.seller_billing for select to authenticated using(public.active_user() and (seller_id=auth.uid() or public.is_admin()));
create or replace function public.workspace_command(action text,payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid:=auth.uid(); admin boolean:=public.is_admin(); rid uuid; vid uuid; sid uuid; q integer; delta integer; prod uuid;
 cr public.credit_requests; fr public.fulfillment_requests; v public.product_variants; b public.credit_balances;
 seller_terms text; previous_terms text; before_due bigint; target_due integer; change_due integer; move_due integer; manual_due integer; notice_count integer; invite_count integer; maintenance_at timestamptz;
 item public.fulfillment_items; st text; why text:=trim(coalesce(payload->>'reason','')); label jsonb; result jsonb:='{}';
begin
 if not public.active_user() then raise exception 'Your account is not active or email is not verified'; end if;
 if action in ('approve_credit','verify_payment','review_credit','reject_credit','fulfillment_status','save_product','save_variant','stock_adjust','credit_adjust','suspend_seller','save_settings','add_image','add_asset','archive_product','create_invitation','set_seller_terms','delete_order','restore_order','stock_set','delete_credit_request','restore_credit_request','maintain_workspace','set_seller_outstanding') and not admin then raise exception 'Administrator access required'; end if;
 -- Serialize invoice settlement, approval and manual balance edits for the same seller.
 if action in ('approve_credit','verify_payment','set_seller_outstanding') then
  if action='set_seller_outstanding' then sid:=(payload->>'seller_id')::uuid;
  else select seller_id into sid from public.credit_requests where id=(payload->>'id')::uuid;end if;
  if sid is not null then perform pg_advisory_xact_lock(hashtextextended('billing:'||sid::text,0));end if;
 end if;
 if action='workspace_capabilities' then
  return jsonb_build_object('order_management',true,'credit_request_management',true,'data_retention',true,'account_controls',true);
 elsif action='set_seller_outstanding' then
  target_due:=(payload->>'amount_cents')::integer;
  if target_due is null or target_due<0 or target_due>1000000000 then raise exception 'Enter an amount from $0.00 to $10,000,000.00';end if;
  perform 1 from public.profiles where id=sid and role='seller' for update;
  if not found then raise exception 'Seller not found';end if;
  insert into public.seller_billing(seller_id) values(sid) on conflict do nothing;
  select manual_cents into manual_due from public.seller_billing where seller_id=sid for update;
  select coalesce(sum(outstanding_cents),0)+manual_due into before_due from public.credit_requests where seller_id=sid and status='approved' and payment_status<>'verified';
  if before_due=target_due then return jsonb_build_object('id',sid,'already_applied',true);end if;
  if (payload->>'expected_cents') is null or (payload->>'expected_cents')::bigint<>before_due then raise exception 'This balance changed. Refresh and review the current amount before saving';end if;
  change_due:=target_due-before_due;
  result:=jsonb_build_object('old_outstanding_cents',before_due,'new_outstanding_cents',target_due,'old_manual_cents',manual_due,'request_changes','[]'::jsonb);
  if change_due<0 then
   move_due:=least(manual_due,-change_due);manual_due:=manual_due-move_due;change_due:=change_due+move_due;
   for cr in select * from public.credit_requests where seller_id=sid and status='approved' and payment_status<>'verified' order by approved_at desc nulls last,id for update loop
    exit when change_due=0;
    move_due:=least(cr.outstanding_cents,-change_due);
    if move_due>0 then
     update public.credit_requests set outstanding_cents=outstanding_cents-move_due where id=cr.id;
     result:=jsonb_set(result,'{request_changes}',(result->'request_changes')||jsonb_build_array(jsonb_build_object('id',cr.id,'before',cr.outstanding_cents,'after',cr.outstanding_cents-move_due)));
     change_due:=change_due+move_due;
    end if;
   end loop;
  else
   select * into cr from public.credit_requests where seller_id=sid and status='approved' and payment_status<>'verified' order by approved_at,id limit 1 for update;
   if found then
    update public.credit_requests set outstanding_cents=outstanding_cents+change_due where id=cr.id;
    result:=jsonb_set(result,'{request_changes}',jsonb_build_array(jsonb_build_object('id',cr.id,'before',cr.outstanding_cents,'after',cr.outstanding_cents+change_due)));
   else manual_due:=manual_due+change_due;end if;
  end if;
  update public.seller_billing set manual_cents=manual_due where seller_id=sid;
  result:=result||jsonb_build_object('new_manual_cents',manual_due);rid:=sid;
  insert into public.notifications(user_id,message) values(sid,'Your outstanding balance was updated to $'||to_char(target_due::numeric/100,'FM999999990.00'));
 elsif action='maintain_workspace' then
  -- A settings-row lock serializes tabs; at most one bounded cleanup per day.
  select last_maintenance_at into maintenance_at from public.settings where id for update;
  if maintenance_at>now()-interval '1 day' then return jsonb_build_object('skipped',true);end if;
  delete from public.notifications where id in (
   select id from public.notifications where (read_at is not null and read_at<now()-interval '30 days')
    or (read_at is null and created_at<now()-interval '90 days') order by created_at limit 1000
  );
  get diagnostics notice_count=row_count;
  delete from public.invitations where id in (
   select i.id from public.invitations i where i.accepted_at is null and i.expires_at<now()-interval '90 days'
    and not exists(select 1 from public.profiles p where p.invitation_id=i.id)
    order by i.expires_at limit 1000
  );
  get diagnostics invite_count=row_count;
  update public.settings set last_maintenance_at=now() where id;
  if notice_count+invite_count>0 then
   insert into public.administrator_audit_logs(actor_id,action,details)
    values(uid,action,jsonb_build_object('notifications_removed',notice_count,'expired_invitations_removed',invite_count));
  end if;
  return jsonb_build_object('notifications_removed',notice_count,'expired_invitations_removed',invite_count);
 elsif action in ('delete_credit_request','restore_credit_request') then
  rid:=(payload->>'id')::uuid;
  select * into cr from public.credit_requests where id=rid for update;
  if not found then raise exception 'Request not found';end if;
  if (action='delete_credit_request' and cr.deleted_at is not null) or (action='restore_credit_request' and cr.deleted_at is null) then return jsonb_build_object('id',rid,'already_applied',true);end if;
  update public.credit_requests set deleted_at=case when action='delete_credit_request' then now() else null end,
   deleted_by=case when action='delete_credit_request' then uid else null end,
   deletion_reason=case when action='delete_credit_request' then why else null end where id=rid;
  -- Archival never erases a payment, debt, issued credit or stock commitment.
 elsif action in ('delete_order','restore_order') then
  rid:=(payload->>'id')::uuid;
  select * into fr from public.fulfillment_requests where id=rid for update;
  if not found then raise exception 'Order not found';end if;
  if action='restore_order' then
   if fr.deleted_at is null then return jsonb_build_object('id',rid,'already_applied',true);end if;
   update public.fulfillment_requests set deleted_at=null,deleted_by=null,deletion_reason=null where id=rid;
   -- Restore visibility only: a canceled order must be resubmitted with available credits.
  else
   if fr.deleted_at is not null then return jsonb_build_object('id',rid,'already_applied',true);end if;
   if fr.status in ('pending_review','accepted','packaging') then
    for item in select * from public.fulfillment_items where request_id=rid order by variant_id loop
     perform 1 from public.product_variants where id=item.variant_id for update;
     perform 1 from public.credit_balances where seller_id=fr.seller_id and variant_id=item.variant_id for update;
     update public.credit_balances set available=available+item.quantity,
      reserved=reserved-case when fr.status='pending_review' then item.quantity else 0 end,
      consumed=consumed-case when fr.status in ('accepted','packaging') then item.quantity else 0 end
      where seller_id=fr.seller_id and variant_id=item.variant_id;
     if not found then raise exception 'Credit balance missing';end if;
     insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id)
      values(fr.seller_id,item.variant_id,'released',item.quantity,case when fr.status='pending_review' then -item.quantity else 0 end,case when fr.status in ('accepted','packaging') then -item.quantity else 0 end,rid,'Order deleted before shipment: '||why,uid);
    end loop;
    update public.fulfillment_requests set status='canceled' where id=rid;
    insert into public.order_status_history(request_id,status,actor_id,note) values(rid,'canceled',uid,'Order deleted before shipment: '||why);
   end if;
   -- Shipped/completed orders keep stock, consumed credits, tracking and history intact.
   update public.fulfillment_requests set deleted_at=now(),deleted_by=uid,deletion_reason=why where id=rid;
  end if;
  insert into public.notifications(user_id,message) values(fr.seller_id,'Order '||fr.reference||case when action='delete_order' then ' moved to deleted orders. ' else ' restored to the order list. ' end||why);
 elsif action='stock_set' then
  vid:=(payload->>'variant_id')::uuid;rid:=vid;q:=(payload->>'stock')::integer;
  if q is null or q<0 then raise exception 'A nonnegative whole stock count is required';end if;
  select * into v from public.product_variants where id=vid for update;
  if not found then raise exception 'Variant not found';end if;
  if q<v.committed then raise exception 'Stock cannot be below committed credits. Remove unused credits or resolve orders first';end if;
  delta:=q-v.stock;
  update public.product_variants set stock=q where id=vid;
  insert into public.inventory_ledger(variant_id,stock_delta,reason,actor_id) values(vid,delta,why,uid);
 elsif action='set_seller_terms' then
  sid:=(payload->>'seller_id')::uuid;seller_terms:=payload->>'payment_terms';
  if seller_terms is null or seller_terms not in ('prepaid','pay_later') then raise exception 'Select payment terms';end if;
  select payment_terms into previous_terms from public.profiles where id=sid and role='seller' for update;
  if not found then raise exception 'Seller not found';end if;
  update public.profiles set payment_terms=seller_terms where id=sid;rid:=sid;
  insert into public.notifications(user_id,message) values(sid,case when seller_terms='pay_later' then 'Pay later is enabled. Every credit request still requires administrator approval, and approved credits must be paid for offline.' else 'Pay upfront is required for new credit requests. Existing amounts owed remain payable.' end);
 elsif action='request_credit' then
  select payment_terms into seller_terms from public.profiles where id=uid for update;
  vid:=(payload->>'variant_id')::uuid;q:=(payload->>'quantity')::integer;
  if q is null or q<1 or q>100000 then raise exception 'Invalid quantity';end if;
  select pv.* into v from public.product_variants pv join public.products p on p.id=pv.product_id where pv.id=vid and not p.archived;
  if not found then raise exception 'Product unavailable';end if;
  insert into public.credit_requests(seller_id,variant_id,quantity,unit_cents,notes,payment_terms,status) values(uid,vid,q,v.wholesale_cents,left(coalesce(payload->>'notes',''),2000),seller_terms,case when seller_terms='pay_later' then 'under_review' else 'pending_payment' end) returning id into rid;
  insert into public.notifications(user_id,message) values(uid,case when seller_terms='pay_later' then 'Credit request submitted for administrator approval under pay-later terms.' else 'Credit request submitted. Arrange payment with your administrator.' end);
  insert into public.notifications(user_id,message) select id,case when seller_terms='pay_later' then 'New pay-later credit request awaiting approval' else 'New credit request awaiting payment' end from public.profiles where role='admin' and not suspended;
 elsif action in ('report_payment','cancel_credit','review_credit','reject_credit','verify_payment','approve_credit') then
  rid:=(payload->>'id')::uuid;select * into cr from public.credit_requests where id=rid for update;
  if not found or (cr.seller_id<>uid and not admin) then raise exception 'Request not found';end if;
  if cr.deleted_at is not null then raise exception 'Restore the deleted request before changing it';end if;
  if action='approve_credit' and cr.status='approved' then return jsonb_build_object('id',rid,'already_applied',true);end if;
  if cr.status in ('rejected','canceled') or (cr.status='approved' and not (cr.payment_terms='pay_later' and action in ('report_payment','verify_payment'))) then raise exception 'Request is closed';end if;
  if action='report_payment' then
   if cr.seller_id<>uid or cr.payment_status<>'unpaid' or (cr.status<>'pending_payment' and not (cr.payment_terms='pay_later' and cr.status in ('under_review','approved'))) then raise exception 'Payment cannot be reported';end if;
   update public.credit_requests set payment_status='reported',status=case when status='approved' then status else 'payment_reported' end where id=rid;
   insert into public.notifications(user_id,message) select id,'Seller reported payment. Verify before issuing credits.' from public.profiles where role='admin' and not suspended;
  elsif action='cancel_credit' then
   if cr.seller_id<>uid or exists(select 1 from public.payment_verifications where request_id=rid) then raise exception 'Contact an administrator to cancel a verified request';end if;
   update public.credit_requests set status='canceled' where id=rid;
  elsif action='review_credit' then update public.credit_requests set status='under_review' where id=rid;
  elsif action='reject_credit' then
   update public.credit_requests set status='rejected',decision_reason=why where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,'Credit request rejected: '||why);
  elsif action='verify_payment' then
   insert into public.payment_verifications(request_id,verified_by,paid_at,method,notes) values(rid,uid,(payload->>'paid_at')::timestamptz,trim(payload->>'method'),coalesce(payload->>'notes',''));
   update public.credit_requests set outstanding_cents=0,payment_status='verified',status=case when status='approved' then status else 'under_review' end where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,case when cr.status='approved' then 'Payment verified. The approved credit purchase is now paid in full. No additional credits were issued.' else 'Payment verified. Credit approval is pending.' end);
  elsif action='approve_credit' then
   select payment_terms into seller_terms from public.profiles where id=cr.seller_id for update;
   if not exists(select 1 from public.payment_verifications where request_id=rid) then
    if cr.payment_terms<>'pay_later' then raise exception 'Verify payment before approving credits';end if;
    if seller_terms<>'pay_later' then raise exception 'Seller no longer has pay-later permission. Verify payment before approval';end if;
   end if;
   select * into v from public.product_variants where id=cr.variant_id for update;
   if v.stock-v.committed<cr.quantity then raise exception 'Insufficient uncommitted inventory';end if;
   if exists(select 1 from public.profiles where id=cr.seller_id and suspended) then raise exception 'Seller is suspended';end if;
   insert into public.credit_balances(seller_id,variant_id) values(cr.seller_id,cr.variant_id) on conflict do nothing;
   update public.credit_balances set issued=issued+cr.quantity,available=available+cr.quantity where seller_id=cr.seller_id and variant_id=cr.variant_id;
   update public.product_variants set committed=committed+cr.quantity where id=cr.variant_id;
   insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reference_id,reason,actor_id) values(cr.seller_id,cr.variant_id,'issued',cr.quantity,0,0,rid,case when exists(select 1 from public.payment_verifications where request_id=rid) then 'Verified offline payment approved' else 'Pay-later credit approval: '||why end,uid);
   insert into public.inventory_ledger(variant_id,commitment_delta,reference_id,reason,actor_id) values(cr.variant_id,cr.quantity,rid,'Credit commitment',uid);
   update public.credit_requests set outstanding_cents=case when exists(select 1 from public.payment_verifications where request_id=rid) then 0 else cr.quantity*cr.unit_cents end,status='approved',approved_by=uid,approved_at=now() where id=rid;
   insert into public.notifications(user_id,message) values(cr.seller_id,cr.quantity||' product credits approved and issued. Credits never expire.'||case when cr.payment_terms='pay_later' and cr.payment_status<>'verified' then ' Payment remains due; arrange payment with your administrator.' else '' end);
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
  if fr.deleted_at is not null then raise exception 'Restore the deleted order before changing its status';end if;
  st:=case when action='cancel_fulfillment' then 'canceled' else payload->>'status' end;
  if st=fr.status then return jsonb_build_object('id',rid,'already_applied',true);end if;
  if not ((fr.status='pending_review' and st in ('accepted','rejected','canceled')) or (fr.status='accepted' and st in ('packaging','shipped')) or (fr.status='packaging' and st='shipped') or (fr.status='shipped' and st='completed')) then raise exception 'Invalid order status transition';end if;
  if action='cancel_fulfillment' and (fr.seller_id<>uid or fr.status<>'pending_review') then raise exception 'Only pending requests can be canceled';end if;

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
  if delta is null or delta=0 then raise exception 'A nonzero adjustment is required';end if;
  update public.product_variants set stock=stock+delta where id=vid;
  if not found then raise exception 'Variant not found';end if;
  insert into public.inventory_ledger(variant_id,stock_delta,reason,actor_id) values(vid,delta,why,uid);
 elsif action='credit_adjust' then
  vid:=(payload->>'variant_id')::uuid;sid:=(payload->>'seller_id')::uuid;delta:=(payload->>'delta')::integer;rid:=vid;
  if delta is null or delta=0 then raise exception 'A nonzero adjustment is required';end if;
  perform 1 from public.product_variants where id=vid for update;
  insert into public.credit_balances(seller_id,variant_id) values(sid,vid) on conflict do nothing;
  update public.credit_balances set available=available+delta,issued=issued+delta where seller_id=sid and variant_id=vid;
  update public.product_variants set committed=committed+delta where id=vid;
  insert into public.credit_ledger(seller_id,variant_id,event,available_delta,reserved_delta,consumed_delta,reason,actor_id) values(sid,vid,'adjustment',delta,0,0,why,uid);
  insert into public.inventory_ledger(variant_id,commitment_delta,reason,actor_id) values(vid,delta,why,uid);
 elsif action='suspend_seller' then
  rid:=(payload->>'id')::uuid;if rid=uid then raise exception 'You cannot suspend yourself';end if;
  update public.profiles set suspended=(payload->>'suspended')::boolean where id=rid and role='seller';
 elsif action='save_settings' then update public.settings set payment_instructions=payload->>'payment_instructions',invitation_hours=(payload->>'invitation_hours')::integer where id;
 elsif action='save_profile' then update public.profiles set name=left(trim(payload->>'name'),160) where id=uid;
 elsif action='read_notification' then update public.notifications set read_at=now() where id=(payload->>'id')::uuid and user_id=uid;
 elsif action='create_invitation' then
  -- Called by the Edge Function using the original administrator JWT.
  if exists(select 1 from public.profiles where email=lower(trim(payload->>'email'))) then raise exception 'This email already has an account';end if;
  insert into public.invitations(email,expires_at,invited_by) values(lower(trim(payload->>'email')),now()+make_interval(hours=>(select invitation_hours from public.settings)),uid) returning id into rid;
 else raise exception 'Unknown action';end if;
 if admin and action not in ('read_notification','save_profile') then insert into public.administrator_audit_logs(actor_id,action,reference_id,details) values(uid,action,rid,jsonb_build_object('reason',why)||result||case when action='set_seller_terms' then jsonb_build_object('old_payment_terms',previous_terms,'new_payment_terms',seller_terms) else '{}'::jsonb end);end if;
 return jsonb_build_object('id',rid)||result;
end;$$;



commit;
