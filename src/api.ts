import { createClient } from "@supabase/supabase-js";
const url = import.meta.env.VITE_SUPABASE_URL,
  key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const needsPasswordFlow = ["invite", "recovery"].includes(
  new URLSearchParams(location.hash.slice(1)).get("type") || "",
);
export const configured = !!url && !!key && !url.includes("YOUR_PROJECT");
export const invitationFunction =
  import.meta.env.VITE_INVITATION_FUNCTION || "invite-seller";
export const db = configured ? createClient(url, key) : null;
export async function command(
  action: string,
  payload: Record<string, unknown> = {},
) {
  if (!db) throw new Error("Connect Supabase to use your workspace.");
  const { data, error } = await db.rpc("workspace_command", {
    action,
    payload,
  });
  if (error) throw error;
  return data;
}
export async function read(table: string, options?: { limit?: number }) {
  if (!db) return [];
  let query = db.from(table).select("*");
  if (options?.limit)
    query = query
      .order("created_at", { ascending: false })
      .limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
export async function upload(bucket: string, file: File) {
  if (!db) throw new Error("Supabase is not connected");
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) throw new Error("Sign in first");
  const path = `${user.id}/${crypto.randomUUID()}.${file.name.split(".").pop()?.toLowerCase()}`;
  const { error } = await db.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw error;
  return path;
}
export async function signedLabel(path: string) {
  if (!db) throw new Error("Sign in first");
  const { data, error } = await db.storage
    .from("shipping-labels")
    .createSignedUrl(path, 120);
  if (error) throw error;
  return data.signedUrl;
}
