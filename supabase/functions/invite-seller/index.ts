import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
const origins = (
  Deno.env.get("APP_ORIGINS") || "http://localhost:5173,http://127.0.0.1:5173"
).split(",");
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": origins.includes(origin)
      ? origin
      : origins[0],
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
  const reply = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  try {
    const auth = req.headers.get("authorization");
    if (!auth?.startsWith("Bearer "))
      return reply({ error: "Sign in first" }, 401);
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
      auth: { persistSession: false },
    });
    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return reply({ error: "Invalid session" }, 401);
    const { data: admin, error: roleError } = await userClient.rpc("is_admin");
    if (roleError || !admin)
      return reply({ error: "Administrator access required" }, 403);
    const { email, redirectTo } = await req.json();
    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254
    )
      return reply({ error: "Enter a valid email" }, 400);
    if (
      typeof redirectTo !== "string" ||
      !origins.includes(new URL(redirectTo).origin)
    )
      return reply({ error: "Redirect origin is not allowed" }, 400);
    const { data: inv, error: invError } = await userClient.rpc(
      "workspace_command",
      { action: "create_invitation", payload: { email } },
    );
    if (invError) return reply({ error: invError.message }, 400);
    const privileged = createClient(
      url,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { error: sendError } = await privileged.auth.admin.inviteUserByEmail(
      email.trim().toLowerCase(),
      { redirectTo, data: { needs_password: true } },
    );
    if (sendError) {
      // Remove only an unaccepted invitation after a failed delivery. Audit event is retained.
      await privileged
        .from("invitations")
        .delete()
        .eq("id", inv.id)
        .is("accepted_at", null);
      return reply({ error: sendError.message }, 400);
    }
    return reply({ invitation_id: inv.id });
  } catch {
    return reply(
      { error: "Invitation could not be sent. Check the function logs." },
      500,
    );
  }
});
