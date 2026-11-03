import pg from "pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const url = process.env.DATABASE_URL;
if (
  process.env.RUN_DISPOSABLE_DATABASE_TESTS !== "yes" ||
  !url ||
  !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)
)
  throw Error(
    "This test requires an explicitly disposable LOCAL Supabase database. It creates permanent audit fixtures.",
  );
const pool = new pg.Pool({ connectionString: url, max: 5 });
const admin = randomUUID(),
  seller = randomUUID(),
  stamp = randomUUID();
async function asUser(id, action, payload) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    const { rows } = await c.query(
      "select public.workspace_command($1,$2::jsonb) as result",
      [action, JSON.stringify(payload)],
    );
    await c.query("commit");
    return rows[0].result;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
try {
  for (const [id, role] of [
    [admin, "admin"],
    [seller, "seller"],
  ]) {
    const email = `${role}-${stamp}@example.test`;
    await pool.query(
      "insert into public.invitations(email,expires_at) values($1,now()+interval '1 day')",
      [email],
    );
    await pool.query(
      "insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",
      [id, email],
    );
    if (role === "admin")
      await pool.query("update public.profiles set role='admin' where id=$1", [
        id,
      ]);
  }
  const product = (
    await asUser(admin, "save_product", {
      name: `Concurrency fixture ${stamp}`,
    })
  ).id;
  const variant = (
    await asUser(admin, "save_variant", {
      product_id: product,
      name: "Default",
      sku: stamp,
      wholesale_cents: 800,
      resale_cents: 2000,
    })
  ).id;
  await asUser(admin, "stock_adjust", {
    variant_id: variant,
    delta: 10,
    reason: "Disposable concurrency fixture",
  });
  const cr = (
    await asUser(seller, "request_credit", { variant_id: variant, quantity: 3 })
  ).id;
  await asUser(admin, "verify_payment", {
    id: cr,
    method: "Test only",
    paid_at: new Date().toISOString(),
  });
  await Promise.all([
    asUser(admin, "approve_credit", { id: cr }),
    asUser(admin, "approve_credit", { id: cr }),
  ]);
  let b = (
    await pool.query(
      "select * from public.credit_balances where seller_id=$1 and variant_id=$2",
      [seller, variant],
    )
  ).rows[0];
  assert.equal(b.issued, 3);
  const labels = [
    `${seller}/${randomUUID()}.pdf`,
    `${seller}/${randomUUID()}.pdf`,
  ];
  for (const path of labels)
    await pool.query(
      'insert into storage.objects(bucket_id,name,owner_id,metadata) values(\'shipping-labels\',$1,$2,\'{"mimetype":"application/pdf","size":100}\')',
      [path, seller],
    );
  const submissions = labels.map((path) => ({
    variant_id: variant,
    quantity: 2,
    idempotency_key: randomUUID(),
    marketplace: "eBay",
    labels: [{ path, name: "test.pdf" }],
  }));
  const outcomes = await Promise.allSettled(
    submissions.map((p) => asUser(seller, "submit_fulfillment", p)),
  );
  assert.equal(
    outcomes.filter((o) => o.status === "fulfilled").length,
    1,
    "Only one competing reservation can spend 2 of 3 credits",
  );
  assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1);
  b = (
    await pool.query(
      "select * from public.credit_balances where seller_id=$1 and variant_id=$2",
      [seller, variant],
    )
  ).rows[0];
  assert.equal(b.available, 1);
  assert.equal(b.reserved, 2);
  const duplicate = outcomes.findIndex((o) => o.status === "fulfilled");
  const same = await Promise.all([
    asUser(seller, "submit_fulfillment", submissions[duplicate]),
    asUser(seller, "submit_fulfillment", submissions[duplicate]),
  ]);
  assert.equal(same[0].id, same[1].id);
  console.log(
    "PASS: concurrent approval is idempotent; competing reservations cannot overspend; duplicate submission returns the original order.",
  );
} finally {
  await pool.end();
}
