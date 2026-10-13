import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createClient as publicClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { staffAdminClient } from "@/lib/supabase/admin";

const RECOVERY = "qr-password-recovery";
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

export function recoveryRedirect() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" || (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && local && url.protocol === "http:"))) throw new Error("SITE_URL_NOT_CONFIGURED");
  return url.origin + "/auth/recovery";
}

export function emailAuthClient() {
  return publicClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: "implicit" },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(12000) }) },
  });
}

export async function authLimit(kind: "RESET_EMAIL" | "RESET_IP" | "VERIFY" | "CHANGE", value: string) {
  const { client, fingerprint } = staffAdminClient();
  const { data, error } = await client.rpc("account_auth_limit", { p_kind: kind, p_key_hash: fingerprint([kind, value]) });
  if (error) throw new Error("ACCOUNT_SECURITY_UNAVAILABLE");
  return data === true;
}

export async function requestIp() {
  if (process.env.VERCEL !== "1") return "non-vercel";
  return (await headers()).get("x-vercel-forwarded-for")?.split(",")[0]?.trim().slice(0, 100) || "missing-vercel-ip";
}

export async function currentAccount() {
  const supabase = await createClient(12000);
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  const profile = await supabase.from("profiles").select("full_name,is_active").eq("id", user.id).maybeSingle();
  if (profile.error || !profile.data?.is_active) return null;
  return { supabase, user, profile: profile.data };
}

export async function accountSession(account: NonNullable<Awaited<ReturnType<typeof currentAccount>>>) {
  const { data, error } = await account.supabase.auth.getClaims();
  const id = data?.claims.session_id;
  if (error || data?.claims.sub !== account.user.id || typeof id !== "string" || !uuid.test(id)) throw new Error("ACCOUNT_SESSION_INVALID");
  return id;
}

export async function clearRecovery() {
  (await cookies()).delete(RECOVERY);
}

export async function openRecovery(account: NonNullable<Awaited<ReturnType<typeof currentAccount>>>) {
  const session = await accountSession(account), value = randomBytes(32).toString("hex");
  const { client } = staffAdminClient();
  const { error } = await client.rpc("account_recovery_open", { p_user_id: account.user.id, p_session_id: session, p_grant_hash: digest(value) });
  if (error) throw new Error("ACCOUNT_RECOVERY_UNAVAILABLE");
  (await cookies()).set(RECOVERY, value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 900 });
}

export async function recoveryPermission(account: NonNullable<Awaited<ReturnType<typeof currentAccount>>>, claim = false) {
  const value = (await cookies()).get(RECOVERY)?.value;
  if (!value || !/^[a-f0-9]{64}$/.test(value)) return false;
  const session = await accountSession(account), { client } = staffAdminClient();
  const { data, error } = await client.rpc(claim ? "account_recovery_claim" : "account_recovery_check", { p_user_id: account.user.id, p_session_id: session, p_grant_hash: digest(value) });
  if (error) throw new Error("ACCOUNT_RECOVERY_UNAVAILABLE");
  return data === true;
}

export async function finishPasswordChange(supabase: Awaited<ReturnType<typeof createClient>>) {
  await clearRecovery();
  try { await supabase.auth.signOut({ scope: "global" }); } catch { /* Yerli çıxış aşağıda təmin edilir. */ }
  const store = await cookies();
  const prefix = "sb-" + new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0] + "-auth-token";
  for (const cookie of store.getAll()) if (cookie.name === prefix || cookie.name.startsWith(prefix + ".") || cookie.name === prefix + "-code-verifier") store.delete(cookie.name);
}
