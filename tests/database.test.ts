import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, expect, it } from "vitest";
let pg: PGlite;
const admin = "10000000-0000-0000-0000-000000000001",
  seller = "10000000-0000-0000-0000-000000000002",
  other = "10000000-0000-0000-0000-000000000003";
let product: string, variant: string, request: string, order: string;
async function identity(id: string) {
  await pg.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
}
async function rpc(action: string, payload: Record<string, unknown> = {}) {
  const r = await pg.query<{ result: any }>(
    "select public.workspace_command($1,$2::jsonb) as result",
    [action, JSON.stringify(payload)],
  );
  return r.rows[0].result;
}
async function scalar(sql: string) {
  return (await pg.query<any>(sql)).rows[0];
}
beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth;create schema storage;create schema extensions;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb);
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to authenticated,anon;
 grant select,insert on storage.objects to authenticated;
 grant execute on function auth.uid() to authenticated;
 `);
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/202611020001_workspace.sql",
      import.meta.url,
    ),
    "utf8",
  ).replace(
    "create extension if not exists pgcrypto with schema extensions;",
    "",
  );
  await pg.exec(migration);
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611020002_internal_notes.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030001_payment_terms.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030002_order_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  for (const [id, email] of [
    [admin, "admin@example.test"],
    [seller, "seller@example.test"],
    [other, "other@example.test"],
  ]) {
    await pg.query(
      "insert into public.invitations(email,expires_at) values($1,now()+interval '1 day')",
      [email],
    );
    await pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email],
    );
  }
  await pg.query("update public.profiles set role='admin' where id=$1", [
    admin,
  ]);
  await identity(admin);
}, 30000);
afterAll(async () => await pg.close());
it("rejects creation without an invitation", async () => {
  await expect(
    pg.query(
      "insert into auth.users(id,email) values(gen_random_uuid(),'stranger@example.test')",
    ),
  ).rejects.toThrow("invitation");
});
it("rejects expired invitations", async () => {
  await pg.exec(
    "insert into public.invitations(email,expires_at) values('expired@example.test',now()-interval '1 hour')",
  );
  await expect(
    pg.query(
      "insert into auth.users(id,email) values(gen_random_uuid(),'expired@example.test')",
    ),
  ).rejects.toThrow("invitation");
});
it("does not allow a second use of an accepted invitation", async () => {
  await expect(
    pg.query(
      "insert into auth.users(id,email,email_confirmed_at) values(gen_random_uuid(),'seller@example.test',now())",
    ),
  ).rejects.toThrow("invitation");
});
it("creates products and variants with audited inventory", async () => {
  product = (
    await rpc("save_product", { name: "Test headphones", category: "Audio" })
  ).id;
  variant = (
    await rpc("save_variant", {
      product_id: product,
      name: "Black",
      sku: "TEST-BLK",
      wholesale_cents: 800,
      resale_cents: 2000,
    })
  ).id;
  await rpc("stock_adjust", {
    variant_id: variant,
    delta: 10,
    reason: "Initial receiving",
  });
  expect(
    (await scalar("select stock from public.product_variants")).stock,
  ).toBe(10);
});
it("seller requests credits without receiving a balance", async () => {
  await identity(seller);
  request = (await rpc("request_credit", { variant_id: variant, quantity: 6 }))
    .id;
  expect(
    (await scalar("select count(*)::int as n from public.credit_balances")).n,
  ).toBe(0);
});
it("reporting payment never issues credits", async () => {
  await rpc("report_payment", { id: request });
  expect(
    (await scalar("select status from public.credit_requests")).status,
  ).toBe("payment_reported");
  expect(
    (await scalar("select count(*)::int as n from public.credit_balances")).n,
  ).toBe(0);
});
it("seller cannot verify or approve payment", async () => {
  await expect(
    rpc("verify_payment", {
      id: request,
      method: "cash",
      paid_at: new Date().toISOString(),
    }),
  ).rejects.toThrow("Administrator");
  await expect(rpc("approve_credit", { id: request })).rejects.toThrow(
    "Administrator",
  );
});
it("admin cannot approve without verified payment", async () => {
  await identity(admin);
  await expect(rpc("approve_credit", { id: request })).rejects.toThrow(
    "Verify payment",
  );
});
it("records payment without issuing credits", async () => {
  await rpc("verify_payment", {
    id: request,
    method: "Bank transfer",
    paid_at: new Date().toISOString(),
    notes: "Manually reconciled",
  });
  expect(
    (await scalar("select count(*)::int as n from public.credit_balances")).n,
  ).toBe(0);
});
it("approves atomically and commits physical stock", async () => {
  await rpc("approve_credit", { id: request });
  expect(
    await scalar(
      "select issued,available,reserved,consumed from public.credit_balances",
    ),
  ).toEqual({ issued: 6, available: 6, reserved: 0, consumed: 0 });
  expect(
    (await scalar("select committed from public.product_variants")).committed,
  ).toBe(6);
});
it("repeated approval is idempotent", async () => {
  expect((await rpc("approve_credit", { id: request })).already_applied).toBe(
    true,
  );
  expect(
    (await scalar("select issued from public.credit_balances")).issued,
  ).toBe(6);
});
it("rejects approval exceeding uncommitted stock and rolls back", async () => {
  await identity(seller);
  const id = (await rpc("request_credit", { variant_id: variant, quantity: 5 }))
    .id;
  await identity(admin);
  await rpc("verify_payment", {
    id,
    method: "Cash",
    paid_at: new Date().toISOString(),
  });
  await expect(rpc("approve_credit", { id })).rejects.toThrow("Insufficient");
  expect(
    (await scalar("select issued from public.credit_balances")).issued,
  ).toBe(6);
});
const labelPath = `${seller}/label.pdf`;
const base = () => ({
  variant_id: variant,
  quantity: 2,
  idempotency_key: "20000000-0000-0000-0000-000000000001",
  marketplace: "eBay",
  labels: [{ path: labelPath, name: "label.pdf" }],
});
it("requires a real, owned uploaded shipping label", async () => {
  await identity(seller);
  await expect(rpc("submit_fulfillment", base())).rejects.toThrow(
    "Invalid shipping label",
  );
  await pg.query(
    "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
    [labelPath],
  );
});
it("rejects insufficient credits", async () => {
  await expect(
    rpc("submit_fulfillment", { ...base(), quantity: 7 }),
  ).rejects.toThrow("Insufficient");
});
it("reserves credits without consuming them or deducting physical stock", async () => {
  order = (await rpc("submit_fulfillment", base())).id;
  expect(
    await scalar(
      "select available,reserved,consumed from public.credit_balances",
    ),
  ).toEqual({ available: 4, reserved: 2, consumed: 0 });
  expect(
    (await scalar("select stock from public.product_variants")).stock,
  ).toBe(10);
});
it("prevents duplicate fulfillment with the same idempotency key", async () => {
  expect((await rpc("submit_fulfillment", base())).already_applied).toBe(true);
  expect(
    (await scalar("select count(*)::int as n from public.fulfillment_requests"))
      .n,
  ).toBe(1);
});
it("seller cannot accept their own fulfillment", async () => {
  await expect(
    rpc("fulfillment_status", { id: order, status: "accepted" }),
  ).rejects.toThrow("Administrator");
});
it("rejection restores reserved credits but retains product commitments", async () => {
  await identity(admin);
  await rpc("fulfillment_status", {
    id: order,
    status: "rejected",
    reason: "Label is unreadable",
  });
  expect(
    await scalar(
      "select available,reserved,consumed from public.credit_balances",
    ),
  ).toEqual({ available: 6, reserved: 0, consumed: 0 });
  expect(
    (await scalar("select committed from public.product_variants")).committed,
  ).toBe(6);
});
it("cannot reuse a label from a closed order", async () => {
  await identity(seller);
  await expect(
    rpc("submit_fulfillment", {
      ...base(),
      idempotency_key: crypto.randomUUID(),
    }),
  ).rejects.toThrow();
  expect(
    (await scalar("select available from public.credit_balances")).available,
  ).toBe(6);
});
it("acceptance consumes credits, shipment deducts inventory exactly once", async () => {
  const path = `${seller}/second.pdf`;
  await pg.query(
    "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
    [path],
  );
  const id = (
    await rpc("submit_fulfillment", {
      ...base(),
      idempotency_key: crypto.randomUUID(),
      labels: [{ path, name: "second.pdf" }],
    })
  ).id;
  await identity(admin);
  await rpc("fulfillment_status", { id, status: "accepted" });
  expect(
    await scalar(
      "select available,reserved,consumed from public.credit_balances",
    ),
  ).toEqual({ available: 4, reserved: 0, consumed: 2 });
  await rpc("fulfillment_status", {
    id,
    status: "shipped",
    tracking: "TRACK-123",
  });
  await rpc("fulfillment_status", {
    id,
    status: "shipped",
    tracking: "TRACK-123",
  });
  expect(
    await scalar("select stock,committed,shipped from public.product_variants"),
  ).toEqual({ stock: 8, committed: 4, shipped: 2 });
  await rpc("fulfillment_status", { id, status: "completed" });
});
it("cancels only eligible pending fulfillment and releases credits", async () => {
  await identity(seller);
  const path = `${seller}/third.pdf`;
  await pg.query(
    "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
    [path],
  );
  const id = (
    await rpc("submit_fulfillment", {
      ...base(),
      idempotency_key: crypto.randomUUID(),
      quantity: 1,
      labels: [{ path, name: "third.pdf" }],
    })
  ).id;
  await rpc("cancel_fulfillment", { id });
  expect(
    await scalar("select available,reserved from public.credit_balances"),
  ).toEqual({ available: 4, reserved: 0 });
});
it("cannot reduce physical stock below outstanding commitments", async () => {
  await identity(admin);
  await expect(
    rpc("stock_adjust", {
      variant_id: variant,
      delta: -5,
      reason: "Bad adjustment",
    }),
  ).rejects.toThrow();
});
it("manual credit adjustments require a reason and respect stock", async () => {
  await expect(
    rpc("credit_adjust", { seller_id: seller, variant_id: variant, delta: 1 }),
  ).rejects.toThrow("reason");
  await expect(
    rpc("credit_adjust", {
      seller_id: seller,
      variant_id: variant,
      delta: 20,
      reason: "Too many",
    }),
  ).rejects.toThrow();
  await rpc("credit_adjust", {
    seller_id: seller,
    variant_id: variant,
    delta: -1,
    reason: "Documented refund",
  });
  expect(
    (await scalar("select available from public.credit_balances")).available,
  ).toBe(3);
});
it("audit ledgers and payment verifications are immutable", async () => {
  for (const table of [
    "credit_ledger",
    "inventory_ledger",
    "administrator_audit_logs",
    "payment_verifications",
    "order_status_history",
  ])
    await expect(pg.exec(`delete from public.${table}`)).rejects.toThrow(
      "immutable",
    );
});
it("administrator internal notes stay private to administrators", async () => {
  await identity(admin);
  await pg.query("select public.add_internal_note($1,$2)", [
    order,
    "Private packaging instruction",
  ]);
  await identity(seller);
  await pg.exec("set role authenticated");
  expect(
    (
      await scalar(
        "select count(*)::int as n from public.fulfillment_internal_notes",
      )
    ).n,
  ).toBe(0);
  await expect(
    pg.query("select public.add_internal_note($1,$2)", [
      order,
      "Seller attempt",
    ]),
  ).rejects.toThrow("Administrator");
  await pg.exec("reset role");
});
it("shipping label policies isolate sellers and permit assigned administrator access", async () => {
  await identity(other);
  await pg.exec("set role authenticated");
  expect(
    (
      await scalar(
        "select count(*)::int as n from storage.objects where bucket_id='shipping-labels'",
      )
    ).n,
  ).toBe(0);
  await expect(
    pg.query(
      "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
      [`${seller}/unauthorized.pdf`],
    ),
  ).rejects.toThrow("row-level security");
  await pg.exec("reset role");
  await identity(admin);
  await pg.exec("set role authenticated");
  expect(
    (
      await scalar(
        "select count(*)::int as n from storage.objects where bucket_id='shipping-labels'",
      )
    ).n,
  ).toBe(3);
  await pg.exec("reset role");
});
it("expired invitation cannot be confirmed after the auth user was provisioned", async () => {
  const id = crypto.randomUUID();
  await pg.exec(
    "insert into public.invitations(email,expires_at) values('late@example.test',now()+interval '1 hour')",
  );
  await pg.query(
    "insert into auth.users(id,email) values($1,'late@example.test')",
    [id],
  );
  await pg.exec(
    "update public.invitations set expires_at=now()-interval '1 hour' where email='late@example.test'",
  );
  await expect(
    pg.query("update auth.users set email_confirmed_at=now() where id=$1", [
      id,
    ]),
  ).rejects.toThrow("expired");
  await identity(id);
  await expect(
    rpc("request_credit", { variant_id: variant, quantity: 1 }),
  ).rejects.toThrow("not active");
});
it("RLS isolates seller data and blocks direct balance edits", async () => {
  await identity(other);
  await pg.exec("set role authenticated");
  expect(
    (await scalar("select count(*)::int as n from public.credit_requests")).n,
  ).toBe(0);
  expect(
    (await scalar("select count(*)::int as n from public.fulfillment_requests"))
      .n,
  ).toBe(0);
  expect(
    (await scalar("select count(*)::int as n from public.profiles")).n,
  ).toBe(1);
  await expect(
    pg.exec("update public.credit_balances set available=100"),
  ).rejects.toThrow("permission denied");
  await expect(
    pg.exec("select public.workspace_command('stock_adjust','{}')"),
  ).rejects.toThrow("Administrator");
  await pg.exec("reset role");
});
it("signed-out callers have no business API access", async () => {
  await identity("");
  await pg.exec("set role anon");
  await expect(pg.exec("select * from public.products")).rejects.toThrow(
    "permission denied",
  );
  await expect(
    pg.exec("select public.workspace_command('request_credit','{}')"),
  ).rejects.toThrow("permission denied");
  await pg.exec("reset role");
});
it("suspended accounts lose read and command access immediately", async () => {
  await identity(admin);
  await rpc("suspend_seller", {
    id: seller,
    suspended: true,
    reason: "Account review",
  });
  await identity(seller);
  await pg.exec("set role authenticated");
  expect(
    (await scalar("select count(*)::int as n from public.credit_balances")).n,
  ).toBe(0);
  await expect(
    rpc("request_credit", { variant_id: variant, quantity: 1 }),
  ).rejects.toThrow("not active");
  await pg.exec("reset role");
});

let termsVariant: string, prepaidSnapshot: string, deferredRequest: string;
it("defaults existing sellers to pay upfront and ignores seller-supplied payment terms", async () => {
  await identity(admin);
  const p = (await rpc("save_product", { name: "Payment terms fixture" })).id;
  termsVariant = (
    await rpc("save_variant", {
      product_id: p,
      name: "Default",
      sku: "TERMS-TEST",
      wholesale_cents: 499,
      resale_cents: 999,
    })
  ).id;
  await rpc("stock_adjust", {
    variant_id: termsVariant,
    delta: 20,
    reason: "Test fixture",
  });
  await identity(other);
  prepaidSnapshot = (
    await rpc("request_credit", {
      variant_id: termsVariant,
      quantity: 1,
      payment_terms: "pay_later",
    })
  ).id;
  const r = (
    await pg.query<any>(
      "select payment_terms,payment_status,status from public.credit_requests where id=$1",
      [prepaidSnapshot],
    )
  ).rows[0];
  expect(r).toEqual({
    payment_terms: "prepaid",
    payment_status: "unpaid",
    status: "pending_payment",
  });
});
it("seller cannot grant themselves pay-later permission or edit the profile directly", async () => {
  await expect(
    rpc("set_seller_terms", {
      seller_id: other,
      payment_terms: "pay_later",
      reason: "Self grant",
    }),
  ).rejects.toThrow("Administrator");
  await pg.exec("set role authenticated");
  await expect(
    pg.query(
      "update public.profiles set payment_terms='pay_later' where id=$1",
      [other],
    ),
  ).rejects.toThrow("permission denied");
  await pg.exec("reset role");
});
it("administrator changes require a reason and preserve earlier request terms", async () => {
  await identity(admin);
  await expect(
    rpc("set_seller_terms", { seller_id: other, payment_terms: "pay_later" }),
  ).rejects.toThrow("reason");
  await rpc("set_seller_terms", {
    seller_id: other,
    payment_terms: "pay_later",
    reason: "Owner-approved payment arrangement",
  });
  await expect(
    rpc("approve_credit", { id: prepaidSnapshot, reason: "Old request" }),
  ).rejects.toThrow("Verify payment");
  const audit = (
    await pg.query<any>(
      "select details from public.administrator_audit_logs where action='set_seller_terms' order by created_at desc limit 1",
    )
  ).rows[0];
  expect(audit.details.old_payment_terms).toBe("prepaid");
  expect(audit.details.new_payment_terms).toBe("pay_later");
});
it("pay-later requests still issue no credits before administrator approval", async () => {
  await identity(other);
  deferredRequest = (
    await rpc("request_credit", { variant_id: termsVariant, quantity: 2 })
  ).id;
  const r = (
    await pg.query<any>(
      "select payment_terms,payment_status,status from public.credit_requests where id=$1",
      [deferredRequest],
    )
  ).rows[0];
  expect(r).toEqual({
    payment_terms: "pay_later",
    payment_status: "unpaid",
    status: "under_review",
  });
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, termsVariant],
      )
    ).rows[0].n,
  ).toBe(0);
  await expect(
    rpc("approve_credit", { id: deferredRequest, reason: "Self approve" }),
  ).rejects.toThrow("Administrator");
});
it("pay-later permission does not bypass the approved-credit requirement for labels", async () => {
  await identity(other);
  await expect(
    rpc("submit_fulfillment", {
      variant_id: termsVariant,
      quantity: 1,
      idempotency_key: crypto.randomUUID(),
      marketplace: "eBay",
      labels: [],
    }),
  ).rejects.toThrow("Insufficient");
});
it("admin approves unpaid pay-later credits atomically with reason and inventory commitment", async () => {
  await identity(admin);
  await expect(rpc("approve_credit", { id: deferredRequest })).rejects.toThrow(
    "reason",
  );
  await rpc("approve_credit", {
    id: deferredRequest,
    reason: "Approved trusted seller arrangement",
  });
  const balance = (
    await pg.query<any>(
      "select issued,available from public.credit_balances where seller_id=$1 and variant_id=$2",
      [other, termsVariant],
    )
  ).rows[0];
  expect(balance).toEqual({ issued: 2, available: 2 });
  expect(
    (
      await pg.query<any>(
        "select committed from public.product_variants where id=$1",
        [termsVariant],
      )
    ).rows[0].committed,
  ).toBe(2);
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.payment_verifications where request_id=$1",
        [deferredRequest],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await pg.query<any>(
        "select quantity*unit_cents as owed,payment_status from public.credit_requests where id=$1",
        [deferredRequest],
      )
    ).rows[0],
  ).toEqual({ owed: 998, payment_status: "unpaid" });
  expect(
    (await rpc("approve_credit", { id: deferredRequest })).already_applied,
  ).toBe(true);
});
it("approved pay-later credits can reserve fulfillment before payment without losing the amount owed", async () => {
  await identity(other);
  const path = `${other}/pay-later-test.pdf`;
  await pg.query(
    "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
    [path],
  );
  const fr = (
    await rpc("submit_fulfillment", {
      variant_id: termsVariant,
      quantity: 1,
      idempotency_key: crypto.randomUUID(),
      marketplace: "eBay",
      labels: [{ path, name: "pay-later-test.pdf" }],
    })
  ).id;
  expect(
    (
      await pg.query<any>(
        "select reserved from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, termsVariant],
      )
    ).rows[0].reserved,
  ).toBe(1);
  expect(
    (
      await pg.query<any>(
        "select payment_status from public.credit_requests where id=$1",
        [deferredRequest],
      )
    ).rows[0].payment_status,
  ).toBe("unpaid");
  await identity(admin);
  await rpc("fulfillment_status", {
    id: fr,
    status: "rejected",
    reason: "Test label rejected",
  });
  expect(
    (
      await pg.query<any>(
        "select available from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, termsVariant],
      )
    ).rows[0].available,
  ).toBe(2);
});
it("reporting later payment preserves approval and does not issue extra credits", async () => {
  await identity(other);
  await rpc("report_payment", { id: deferredRequest });
  expect(
    (
      await pg.query<any>(
        "select status,payment_status from public.credit_requests where id=$1",
        [deferredRequest],
      )
    ).rows[0],
  ).toEqual({ status: "approved", payment_status: "reported" });
  expect(
    (
      await pg.query<any>(
        "select issued from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, termsVariant],
      )
    ).rows[0].issued,
  ).toBe(2);
  await expect(rpc("report_payment", { id: deferredRequest })).rejects.toThrow(
    "cannot be reported",
  );
});
it("verification after approval settles the payment exactly once without issuing again", async () => {
  await expect(
    rpc("verify_payment", {
      id: deferredRequest,
      method: "Cash",
      paid_at: new Date().toISOString(),
    }),
  ).rejects.toThrow("Administrator");
  await identity(admin);
  await rpc("verify_payment", {
    id: deferredRequest,
    method: "Bank transfer",
    paid_at: new Date().toISOString(),
    notes: "Full amount received",
  });
  expect(
    (
      await pg.query<any>(
        "select status,payment_status from public.credit_requests where id=$1",
        [deferredRequest],
      )
    ).rows[0],
  ).toEqual({ status: "approved", payment_status: "verified" });
  expect(
    (
      await pg.query<any>(
        "select issued from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, termsVariant],
      )
    ).rows[0].issued,
  ).toBe(2);
  await expect(
    rpc("verify_payment", {
      id: deferredRequest,
      method: "Cash",
      paid_at: new Date().toISOString(),
    }),
  ).rejects.toThrow();
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.credit_ledger where reference_id=$1 and event='issued'",
        [deferredRequest],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("revoking permission blocks unpaid approval but preserves existing unpaid obligations", async () => {
  await identity(other);
  const r = (
    await rpc("request_credit", { variant_id: termsVariant, quantity: 1 })
  ).id;
  const alreadyApproved = (
    await rpc("request_credit", { variant_id: termsVariant, quantity: 1 })
  ).id;
  await identity(admin);
  await rpc("approve_credit", {
    id: alreadyApproved,
    reason: "Approved before revocation",
  });
  await rpc("set_seller_terms", {
    seller_id: other,
    payment_terms: "prepaid",
    reason: "Require upfront payment from now on",
  });
  await expect(
    rpc("approve_credit", { id: r, reason: "Attempt after revocation" }),
  ).rejects.toThrow("no longer");
  const debt = (
    await pg.query<any>(
      "select status,payment_status,payment_terms from public.credit_requests where id=$1",
      [alreadyApproved],
    )
  ).rows[0];
  expect(debt).toEqual({
    status: "approved",
    payment_status: "unpaid",
    payment_terms: "pay_later",
  });
  await rpc("verify_payment", {
    id: r,
    method: "Cash",
    paid_at: new Date().toISOString(),
  });
  await rpc("approve_credit", { id: r });
});
it("pay-later approvals cannot overcommit inventory", async () => {
  await identity(admin);
  await rpc("set_seller_terms", {
    seller_id: other,
    payment_terms: "pay_later",
    reason: "Re-enable for stock boundary test",
  });
  await identity(other);
  const r = (
    await rpc("request_credit", { variant_id: termsVariant, quantity: 20 })
  ).id;
  await identity(admin);
  await expect(
    rpc("approve_credit", { id: r, reason: "Insufficient inventory test" }),
  ).rejects.toThrow("Insufficient");
});

// Dedicated fixtures keep each order state independent of the earlier workflow tests.
async function deletionFixture(state: string) {
  await identity(admin);
  await rpc("suspend_seller", {
    id: seller,
    suspended: false,
    reason: "Restore isolated test seller for order tests",
  });
  const v = (
    await rpc("save_variant", {
      product_id: product,
      name: "Delete " + state,
      sku: "DELETE-" + state,
      wholesale_cents: 100,
      resale_cents: 200,
    })
  ).id;
  await rpc("stock_adjust", {
    variant_id: v,
    delta: 10,
    reason: "Deletion test fixture",
  });
  await rpc("credit_adjust", {
    variant_id: v,
    seller_id: seller,
    delta: 3,
    reason: "Deletion test fixture",
  });
  await identity(seller);
  const path = seller + "/" + crypto.randomUUID() + ".pdf";
  await pg.query(
    "insert into storage.objects(bucket_id,name) values('shipping-labels',$1)",
    [path],
  );
  const o = (
    await rpc("submit_fulfillment", {
      variant_id: v,
      quantity: 2,
      idempotency_key: crypto.randomUUID(),
      marketplace: "TEST ONLY",
      labels: [{ path, name: "Test label" }],
    })
  ).id;
  await identity(admin);
  if (["accepted", "packaging", "shipped", "completed"].includes(state))
    await rpc("fulfillment_status", { id: o, status: "accepted" });
  if (state === "packaging")
    await rpc("fulfillment_status", { id: o, status: "packaging" });
  if (["shipped", "completed"].includes(state))
    await rpc("fulfillment_status", {
      id: o,
      status: "shipped",
      tracking: "TEST ONLY",
    });
  if (state === "completed")
    await rpc("fulfillment_status", { id: o, status: "completed" });
  if (["rejected", "canceled"].includes(state))
    await rpc("fulfillment_status", {
      id: o,
      status: state,
      reason: "Test only",
    });
  return { v, o };
}
for (const state of [
  "pending_review",
  "accepted",
  "packaging",
  "shipped",
  "completed",
  "rejected",
  "canceled",
]) {
  it(
    "deletes and restores " +
      state +
      " orders without duplicate credits or phantom stock",
    async () => {
      const { v, o } = await deletionFixture(state);
      const shipped = ["shipped", "completed"].includes(state);
      await rpc("delete_order", { id: o, reason: "Owner requested removal" });
      expect(
        (await rpc("delete_order", { id: o, reason: "Retry" })).already_applied,
      ).toBe(true);
      const balance = (
        await pg.query<any>(
          "select available,reserved,consumed,issued from public.credit_balances where seller_id=$1 and variant_id=$2",
          [seller, v],
        )
      ).rows[0];
      expect(balance).toEqual({
        available: shipped ? 1 : 3,
        reserved: 0,
        consumed: shipped ? 2 : 0,
        issued: 3,
      });
      expect(
        (
          await pg.query<any>(
            "select stock,committed,shipped from public.product_variants where id=$1",
            [v],
          )
        ).rows[0],
      ).toEqual({
        stock: shipped ? 8 : 10,
        committed: shipped ? 1 : 3,
        shipped: shipped ? 2 : 0,
      });
      await expect(
        rpc("fulfillment_status", { id: o, status: "accepted" }),
      ).rejects.toThrow("Restore");
      await identity(seller);
      await expect(
        rpc("restore_order", { id: o, reason: "Unauthorized" }),
      ).rejects.toThrow("Administrator");
      await identity(admin);
      await rpc("restore_order", { id: o, reason: "Recover record" });
      expect(
        (await rpc("restore_order", { id: o, reason: "Retry" }))
          .already_applied,
      ).toBe(true);
      const restored = (
        await pg.query<any>(
          "select status,deleted_at from public.fulfillment_requests where id=$1",
          [o],
        )
      ).rows[0];
      expect(restored).toEqual({
        status: ["pending_review", "accepted", "packaging"].includes(state)
          ? "canceled"
          : state,
        deleted_at: null,
      });
    },
  );
}

it("can reapply the order update and advertises both management controls", async () => {
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030002_order_management.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await identity(admin);
  expect(await rpc("workspace_capabilities")).toEqual({
    order_management: true,
    credit_request_management: true,
    data_retention: true,
  });
});
it("restricts deletion and stock setting to administrators and requires a reason", async () => {
  const { v, o } = await deletionFixture("permissions");
  await identity(seller);
  await expect(rpc("delete_order", { id: o, reason: "No" })).rejects.toThrow(
    "Administrator",
  );
  await expect(
    rpc("stock_set", { variant_id: v, stock: 15, reason: "No" }),
  ).rejects.toThrow("Administrator");
  await identity(admin);
  await expect(rpc("delete_order", { id: o })).rejects.toThrow("reason");
  await expect(rpc("stock_set", { variant_id: v, stock: 15 })).rejects.toThrow(
    "reason",
  );
  await expect(
    rpc("stock_set", { variant_id: v, stock: 2, reason: "Too low" }),
  ).rejects.toThrow("committed");
  await rpc("stock_set", {
    variant_id: v,
    stock: 15,
    reason: "Physical count",
  });
  expect(
    (
      await pg.query<any>(
        "select stock,committed from public.product_variants where id=$1",
        [v],
      )
    ).rows[0],
  ).toEqual({ stock: 15, committed: 3 });
  expect(
    (
      await pg.query<any>(
        "select stock_delta from public.inventory_ledger where variant_id=$1 and reason='Physical count'",
        [v],
      )
    ).rows[0].stock_delta,
  ).toBe(5);
  await expect(
    rpc("stock_set", { variant_id: v, stock: -1, reason: "Invalid" }),
  ).rejects.toThrow();
});

it("archives approved purchases without hiding their debt or changing issued credits, and restores them", async () => {
  await identity(admin);
  await rpc("set_seller_terms", {
    seller_id: other,
    payment_terms: "pay_later",
    reason: "Test archive",
  });
  const v = (
    await rpc("save_variant", {
      product_id: product,
      name: "Archive purchase",
      sku: "ARCHIVE-PURCHASE",
      wholesale_cents: 499,
      resale_cents: 999,
    })
  ).id;
  await rpc("stock_adjust", {
    variant_id: v,
    delta: 20,
    reason: "Test fixture",
  });
  await identity(other);
  const r = (await rpc("request_credit", { variant_id: v, quantity: 3 })).id;
  await expect(
    rpc("delete_credit_request", { id: r, reason: "No" }),
  ).rejects.toThrow("Administrator");
  await identity(admin);
  await rpc("approve_credit", { id: r, reason: "Test purchase" });
  await expect(rpc("delete_credit_request", { id: r })).rejects.toThrow(
    "reason",
  );
  await rpc("delete_credit_request", { id: r, reason: "Hide test record" });
  expect(
    (await rpc("delete_credit_request", { id: r, reason: "Retry" }))
      .already_applied,
  ).toBe(true);
  const archived = (
    await pg.query<any>(
      "select status,payment_status,quantity*unit_cents owed,deleted_at from public.credit_requests where id=$1",
      [r],
    )
  ).rows[0];
  expect(archived).toMatchObject({
    status: "approved",
    payment_status: "unpaid",
    owed: 1497,
  });
  expect(archived.deleted_at).toBeTruthy();
  expect(
    (
      await pg.query<any>(
        "select issued,available from public.credit_balances where seller_id=$1 and variant_id=$2",
        [other, v],
      )
    ).rows[0],
  ).toEqual({ issued: 3, available: 3 });
  await expect(
    rpc("verify_payment", {
      id: r,
      method: "Cash",
      paid_at: new Date().toISOString(),
    }),
  ).rejects.toThrow("Restore");
  await rpc("restore_credit_request", { id: r, reason: "Need to settle" });
  await rpc("verify_payment", {
    id: r,
    method: "Cash",
    paid_at: new Date().toISOString(),
  });
  expect(
    (
      await pg.query<any>(
        "select payment_status,deleted_at from public.credit_requests where id=$1",
        [r],
      )
    ).rows[0],
  ).toEqual({ payment_status: "verified", deleted_at: null });
});
for (const state of [
  "pending_payment",
  "payment_reported",
  "under_review",
  "rejected",
  "canceled",
]) {
  it(
    "archives " +
      state +
      " credit requests and blocks processing until restored",
    async () => {
      await identity(other);
      const r = (
        await rpc("request_credit", { variant_id: termsVariant, quantity: 1 })
      ).id;
      await pg.query(
        "update public.credit_requests set status=$1 where id=$2",
        [state, r],
      );
      await identity(admin);
      await rpc("delete_credit_request", { id: r, reason: "Owner requested" });
      await expect(
        rpc("approve_credit", { id: r, reason: "Blocked" }),
      ).rejects.toThrow("Restore");
      await rpc("restore_credit_request", { id: r, reason: "Recover" });
      expect(
        (
          await pg.query<any>(
            "select status,deleted_at from public.credit_requests where id=$1",
            [r],
          )
        ).rows[0],
      ).toEqual({ status: state, deleted_at: null });
    },
  );
}

it("cleans up only stale disposable data, protects linked invitations, and throttles empty runs", async () => {
  await identity(admin);
  const beforeAudit = (
    await scalar("select count(*)::int n from public.administrator_audit_logs")
  ).n;
  const beforeLedger = (
    await scalar("select count(*)::int n from public.credit_ledger")
  ).n;
  await pg.query(
    "insert into public.notifications(user_id,message,created_at,read_at) values ($1,'old read',now()-interval '60 days',now()-interval '31 days'),($1,'old unread',now()-interval '91 days',null),($1,'recent read',now()-interval '60 days',now()-interval '1 day'),($1,'recent unread',now()-interval '10 days',null)",
    [admin],
  );
  await pg.exec(
    "insert into public.invitations(email,expires_at) values('stale@example.test',now()-interval '91 days'),('recent-expired@example.test',now()-interval '1 day')",
  );
  await pg.query(
    "update public.invitations set accepted_at=null,expires_at=now()-interval '100 days' where id=(select invitation_id from public.profiles where id=$1)",
    [seller],
  );
  await identity(other);
  await expect(rpc("maintain_workspace")).rejects.toThrow("Administrator");
  await identity(admin);
  expect(await rpc("maintain_workspace")).toEqual({
    notifications_removed: 2,
    expired_invitations_removed: 1,
  });
  expect(
    (
      await scalar(
        "select count(*)::int n from public.notifications where message in ('recent read','recent unread')",
      )
    ).n,
  ).toBe(2);
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.invitations where id=(select invitation_id from public.profiles where id=$1)",
        [seller],
      )
    ).rows[0].n,
  ).toBe(1);
  expect(
    (await scalar("select count(*)::int n from public.credit_ledger")).n,
  ).toBe(beforeLedger);
  expect(
    (
      await scalar(
        "select count(*)::int n from public.administrator_audit_logs",
      )
    ).n,
  ).toBe(beforeAudit + 1);
  expect(await rpc("maintain_workspace")).toEqual({ skipped: true });
  await pg.exec(
    "update public.settings set last_maintenance_at=now()-interval '2 days'",
  );
  expect(await rpc("maintain_workspace")).toEqual({
    notifications_removed: 0,
    expired_invitations_removed: 0,
  });
  expect(
    (
      await scalar(
        "select count(*)::int n from public.administrator_audit_logs",
      )
    ).n,
  ).toBe(beforeAudit + 1);
});

let billingSeller: string,
  billingVariant: string,
  billOne: string,
  billTwo: string;
async function due() {
  return (
    await pg.query<any>(
      "select (select coalesce(sum(outstanding_cents),0) from public.credit_requests where seller_id=$1 and status='approved' and payment_status<>'verified')+coalesce((select manual_cents from public.seller_billing where seller_id=$1),0) as cents",
      [billingSeller],
    )
  ).rows[0].cents;
}
it("activates optional reasons and initializes receivables without overwriting adjustments on reapply", async () => {
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030003_account_controls.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await identity(admin);
  expect((await rpc("workspace_capabilities")).account_controls).toBe(true);
  billingSeller = crypto.randomUUID();
  await pg.exec(
    "insert into public.invitations(email,expires_at) values('billing@example.test',now()+interval '1 day')",
  );
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'billing@example.test',now())",
    [billingSeller],
  );
  await rpc("set_seller_terms", {
    seller_id: billingSeller,
    payment_terms: "pay_later",
  });
  billingVariant = (
    await rpc("save_variant", {
      product_id: product,
      name: "Billing test",
      sku: "BILLING-TEST",
      wholesale_cents: 499,
      resale_cents: 999,
    })
  ).id;
  await rpc("stock_set", { variant_id: billingVariant, stock: 20 });
  await identity(billingSeller);
  billOne = (
    await rpc("request_credit", { variant_id: billingVariant, quantity: 3 })
  ).id;
  billTwo = (
    await rpc("request_credit", { variant_id: billingVariant, quantity: 2 })
  ).id;
  await identity(admin);
  await rpc("approve_credit", { id: billOne });
  await rpc("approve_credit", { id: billTwo });
  expect(Number(await due())).toBe(2495);
});
it("sets a seller's outstanding total without a reason and preserves credits, stock and payment status", async () => {
  const before = (
    await pg.query<any>(
      "select stock,committed from public.product_variants where id=$1",
      [billingVariant],
    )
  ).rows[0];
  const credits = (
    await pg.query<any>(
      "select * from public.credit_balances where seller_id=$1 and variant_id=$2",
      [billingSeller, billingVariant],
    )
  ).rows[0];
  await rpc("set_seller_outstanding", {
    seller_id: billingSeller,
    amount_cents: 1497,
    expected_cents: 2495,
  });
  expect(Number(await due())).toBe(1497);
  expect(
    (
      await pg.query<any>(
        "select stock,committed from public.product_variants where id=$1",
        [billingVariant],
      )
    ).rows[0],
  ).toEqual(before);
  expect(
    (
      await pg.query<any>(
        "select * from public.credit_balances where seller_id=$1 and variant_id=$2",
        [billingSeller, billingVariant],
      )
    ).rows[0],
  ).toEqual(credits);
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.payment_verifications where request_id in ($1,$2)",
        [billOne, billTwo],
      )
    ).rows[0].n,
  ).toBe(0);
  const audit = (
    await pg.query<any>(
      "select details from public.administrator_audit_logs where action='set_seller_outstanding' and reference_id=$1 order by created_at desc limit 1",
      [billingSeller],
    )
  ).rows[0].details;
  expect(audit).toMatchObject({
    reason: "",
    old_outstanding_cents: 2495,
    new_outstanding_cents: 1497,
  });
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030003_account_controls.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(Number(await due())).toBe(1497);
});
it("rejects seller edits, negative/fractional amounts, and stale balance overwrites", async () => {
  await identity(billingSeller);
  await expect(
    rpc("set_seller_outstanding", {
      seller_id: billingSeller,
      amount_cents: 0,
      expected_cents: 1497,
    }),
  ).rejects.toThrow("Administrator");
  await identity(admin);
  await expect(
    rpc("set_seller_outstanding", {
      seller_id: billingSeller,
      amount_cents: -1,
      expected_cents: 1497,
    }),
  ).rejects.toThrow();
  await expect(
    rpc("set_seller_outstanding", {
      seller_id: billingSeller,
      amount_cents: 1.5,
      expected_cents: 1497,
    }),
  ).rejects.toThrow();
  await expect(
    rpc("set_seller_outstanding", {
      seller_id: billingSeller,
      amount_cents: 0,
      expected_cents: 2495,
    }),
  ).rejects.toThrow("balance changed");
  await expect(
    rpc("set_seller_outstanding", {
      seller_id: billingSeller,
      amount_cents: 0,
    }),
  ).rejects.toThrow("balance changed");
  expect(Number(await due())).toBe(1497);
});
it("increases an invoice, clears its adjusted amount on verification, and never creates negative debt", async () => {
  await rpc("set_seller_outstanding", {
    seller_id: billingSeller,
    amount_cents: 1999,
    expected_cents: 1497,
  });
  expect(Number(await due())).toBe(1999);
  const payable = (
    await pg.query<any>(
      "select id from public.credit_requests where seller_id=$1 and outstanding_cents>0",
      [billingSeller],
    )
  ).rows[0].id;
  await rpc("verify_payment", {
    id: payable,
    paid_at: new Date().toISOString(),
    method: "Test payment",
  });
  expect(Number(await due())).toBe(0);
  const issued = (
    await pg.query<any>(
      "select issued from public.credit_balances where seller_id=$1 and variant_id=$2",
      [billingSeller, billingVariant],
    )
  ).rows[0].issued;
  expect(issued).toBe(5);
});
it("supports a manual amount when no invoice is unpaid and clears it without fabricating payment", async () => {
  // Settle the other zero-balance invoice so no unpaid invoice remains.
  const unpaid = (
    await pg.query<any>(
      "select id from public.credit_requests where seller_id=$1 and payment_status<>'verified'",
      [billingSeller],
    )
  ).rows;
  for (const r of unpaid)
    await rpc("verify_payment", {
      id: r.id,
      paid_at: new Date().toISOString(),
      method: "Test settlement",
    });
  await rpc("set_seller_outstanding", {
    seller_id: billingSeller,
    amount_cents: 1200,
    expected_cents: 0,
  });
  expect(Number(await due())).toBe(1200);
  expect(
    (
      await pg.query<any>(
        "select manual_cents from public.seller_billing where seller_id=$1",
        [billingSeller],
      )
    ).rows[0].manual_cents,
  ).toBe(1200);
  await rpc("set_seller_outstanding", {
    seller_id: billingSeller,
    amount_cents: 0,
    expected_cents: 1200,
  });
  expect(Number(await due())).toBe(0);
  expect(
    (
      await rpc("set_seller_outstanding", {
        seller_id: billingSeller,
        amount_cents: 0,
        expected_cents: 1200,
      })
    ).already_applied,
  ).toBe(true);
});
it("allows blank reasons for deletion/restoration, stock and credit changes, permission changes, rejection and suspension", async () => {
  const { v, o } = await deletionFixture("optional-reasons");
  await rpc("delete_order", { id: o });
  await rpc("restore_order", { id: o });
  await rpc("stock_adjust", { variant_id: v, delta: 1 });
  await rpc("credit_adjust", { variant_id: v, seller_id: seller, delta: -1 });
  await identity(billingSeller);
  const r = (
    await rpc("request_credit", { variant_id: billingVariant, quantity: 1 })
  ).id;
  await identity(admin);
  await rpc("reject_credit", { id: r });
  await rpc("delete_credit_request", { id: r });
  await rpc("restore_credit_request", { id: r });
  await rpc("suspend_seller", { id: billingSeller, suspended: true });
  await rpc("suspend_seller", { id: billingSeller, suspended: false });
});
it("isolates seller billing rows and blocks direct account writes through RLS", async () => {
  await identity(other);
  await pg.exec("set role authenticated");
  expect(
    (
      await pg.query<any>(
        "select * from public.seller_billing where seller_id=$1",
        [billingSeller],
      )
    ).rows,
  ).toEqual([]);
  await expect(
    pg.query(
      "update public.seller_billing set manual_cents=0 where seller_id=$1",
      [billingSeller],
    ),
  ).rejects.toThrow();
  await pg.exec("reset role");
  await identity(admin);
});
it("can clear unpaid invoices to zero while new approvals accrue independently", async () => {
  await identity(billingSeller);
  const older = (
    await rpc("request_credit", { variant_id: billingVariant, quantity: 2 })
  ).id;
  await identity(admin);
  await rpc("approve_credit", { id: older });
  await rpc("set_seller_outstanding", {
    seller_id: billingSeller,
    amount_cents: 0,
    expected_cents: 998,
  });
  expect(Number(await due())).toBe(0);
  await identity(billingSeller);
  const newer = (
    await rpc("request_credit", { variant_id: billingVariant, quantity: 1 })
  ).id;
  await identity(admin);
  await rpc("approve_credit", { id: newer });
  expect(Number(await due())).toBe(499);
  await rpc("verify_payment", {
    id: older,
    paid_at: new Date().toISOString(),
    method: "Test only",
  });
  expect(Number(await due())).toBe(499);
});

let autoSeller: string,
  autoVariant: string,
  oldAutoRequest: string,
  prepaidAuto: string;
it("installs automatic approval with manual defaults and blocks sellers from enabling it", async () => {
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030004_auto_approval.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await identity(admin);
  expect((await rpc("workspace_capabilities")).auto_approval).toBe(true);
  autoSeller = crypto.randomUUID();
  await pg.exec(
    "insert into public.invitations(email,expires_at) values('auto@example.test',now()+interval '1 day')",
  );
  await pg.query(
    "insert into auth.users(id,email,email_confirmed_at) values($1,'auto@example.test',now())",
    [autoSeller],
  );
  expect(
    (
      await pg.query<any>(
        "select auto_approve_credits from public.profiles where id=$1",
        [autoSeller],
      )
    ).rows[0].auto_approve_credits,
  ).toBe(false);
  autoVariant = (
    await rpc("save_variant", {
      product_id: product,
      name: "Auto test",
      sku: "AUTO-TEST",
      wholesale_cents: 499,
      resale_cents: 999,
    })
  ).id;
  await rpc("stock_set", { variant_id: autoVariant, stock: 20 });
  await rpc("set_seller_terms", {
    seller_id: autoSeller,
    payment_terms: "pay_later",
  });
  await identity(autoSeller);
  oldAutoRequest = (
    await rpc("request_credit", {
      variant_id: autoVariant,
      quantity: 1,
      auto_approve: true,
    })
  ).id;
  await expect(
    rpc("set_seller_auto_approval", { seller_id: autoSeller, enabled: true }),
  ).rejects.toThrow("Administrator");
  await pg.exec("set role authenticated");
  await expect(
    pg.query("select public.auto_issue_credit($1)", [oldAutoRequest]),
  ).rejects.toThrow();
  await expect(
    pg.query(
      "update public.profiles set auto_approve_credits=true where id=$1",
      [autoSeller],
    ),
  ).rejects.toThrow();
  await pg.exec("reset role");
  await identity(admin);
});
it("automatically approves new pay-later requests and commits stock once without approving older requests", async () => {
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: true,
  });
  await identity(autoSeller);
  const r = await rpc("request_credit", {
    variant_id: autoVariant,
    quantity: 3,
  });
  expect(r.auto_approved).toBe(true);
  expect(
    (
      await pg.query<any>(
        "select status,outstanding_cents,approved_by from public.credit_requests where id=$1",
        [r.id],
      )
    ).rows[0],
  ).toEqual({
    status: "approved",
    outstanding_cents: 1497,
    approved_by: admin,
  });
  expect(
    (
      await pg.query<any>(
        "select status,auto_approve from public.credit_requests where id=$1",
        [oldAutoRequest],
      )
    ).rows[0],
  ).toEqual({ status: "under_review", auto_approve: false });
  expect(
    (
      await pg.query<any>(
        "select stock,committed from public.product_variants where id=$1",
        [autoVariant],
      )
    ).rows[0],
  ).toEqual({ stock: 20, committed: 3 });
  await identity(admin);
  expect((await rpc("approve_credit", { id: r.id })).already_applied).toBe(
    true,
  );
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.credit_ledger where reference_id=$1",
        [r.id],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("leaves over-stock requests in review without partial credit issuance", async () => {
  await identity(autoSeller);
  const r = await rpc("request_credit", {
    variant_id: autoVariant,
    quantity: 18,
  });
  expect(r.auto_approved).toBe(false);
  expect(
    (
      await pg.query<any>(
        "select status,outstanding_cents from public.credit_requests where id=$1",
        [r.id],
      )
    ).rows[0],
  ).toEqual({ status: "under_review", outstanding_cents: 0 });
  expect(
    (
      await pg.query<any>(
        "select available,issued from public.credit_balances where seller_id=$1 and variant_id=$2",
        [autoSeller, autoVariant],
      )
    ).rows[0],
  ).toEqual({ available: 3, issued: 3 });
});
it("waits for verified payment on prepaid auto-approved accounts and issues once afterward", async () => {
  await identity(admin);
  await rpc("set_seller_terms", {
    seller_id: autoSeller,
    payment_terms: "prepaid",
  });
  await identity(autoSeller);
  prepaidAuto = (
    await rpc("request_credit", { variant_id: autoVariant, quantity: 2 })
  ).id;
  await rpc("report_payment", { id: prepaidAuto });
  expect(
    (
      await pg.query<any>(
        "select status from public.credit_requests where id=$1",
        [prepaidAuto],
      )
    ).rows[0].status,
  ).toBe("payment_reported");
  await identity(admin);
  expect(
    (
      await rpc("verify_payment", {
        id: prepaidAuto,
        method: "Test only",
        paid_at: new Date().toISOString(),
      })
    ).auto_approved,
  ).toBe(true);
  expect(
    (
      await pg.query<any>(
        "select status,outstanding_cents from public.credit_requests where id=$1",
        [prepaidAuto],
      )
    ).rows[0],
  ).toEqual({ status: "approved", outstanding_cents: 0 });
  await expect(
    rpc("verify_payment", {
      id: prepaidAuto,
      method: "Test only",
      paid_at: new Date().toISOString(),
    }),
  ).rejects.toThrow();
  expect(
    (
      await pg.query<any>(
        "select count(*)::int n from public.credit_ledger where reference_id=$1",
        [prepaidAuto],
      )
    ).rows[0].n,
  ).toBe(1);
});
it("turning off automatic approval stops pending automatic requests and future requests", async () => {
  await identity(autoSeller);
  const pending = (
    await rpc("request_credit", { variant_id: autoVariant, quantity: 1 })
  ).id;
  await identity(admin);
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: false,
  });
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: true,
  });
  expect(
    (
      await rpc("verify_payment", {
        id: pending,
        method: "Test only",
        paid_at: new Date().toISOString(),
      })
    ).auto_approved,
  ).toBe(false);
  expect(
    (
      await pg.query<any>(
        "select status from public.credit_requests where id=$1",
        [pending],
      )
    ).rows[0].status,
  ).toBe("under_review");
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: false,
  });
  await identity(autoSeller);
  const future = await rpc("request_credit", {
    variant_id: autoVariant,
    quantity: 1,
    auto_approve: true,
  });
  expect(future.auto_approved).toBe(false);
  expect(
    (
      await pg.query<any>(
        "select auto_approve from public.credit_requests where id=$1",
        [future.id],
      )
    ).rows[0].auto_approve,
  ).toBe(false);
  await identity(admin);
});
it("does not bypass revoked pay-later permission or request snapshots when verification occurs", async () => {
  await rpc("set_seller_terms", {
    seller_id: autoSeller,
    payment_terms: "pay_later",
  });
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: true,
  });
  // The older, manually submitted request stays manual even after payment verification.
  expect(
    (
      await rpc("verify_payment", {
        id: oldAutoRequest,
        method: "Test only",
        paid_at: new Date().toISOString(),
      })
    ).auto_approved,
  ).toBe(false);
  await identity(autoSeller);
  const waiting = (
    await rpc("request_credit", { variant_id: autoVariant, quantity: 20 })
  ).id;
  await identity(admin);
  await rpc("set_seller_terms", {
    seller_id: autoSeller,
    payment_terms: "prepaid",
  });
  await rpc("stock_set", { variant_id: autoVariant, stock: 50 });
  await expect(rpc("approve_credit", { id: waiting })).rejects.toThrow(
    "no longer",
  );
  await rpc("set_seller_auto_approval", {
    seller_id: autoSeller,
    enabled: false,
  });
  await pg.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/202611030004_auto_approval.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  expect(
    (
      await pg.query<any>(
        "select auto_approve_credits from public.profiles where id=$1",
        [autoSeller],
      )
    ).rows[0].auto_approve_credits,
  ).toBe(false);
});
