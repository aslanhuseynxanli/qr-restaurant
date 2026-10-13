"use server";
import { authLimit, emailAuthClient, recoveryRedirect, requestIp } from "@/lib/account-security";
import type { PasswordState } from "@/lib/account-password";

export async function requestRecovery(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const value = form.get("email"), email = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: "Email ünvanını düzgün daxil et." };
  let redirectTo: string;
  try { redirectTo = recoveryRedirect(); } catch { return { error: "Bərpa ünvanı qurulmayıb. Platforma admini ilə əlaqə saxla." }; }
  try {
    if (await authLimit("RESET_IP", await requestIp()) && await authLimit("RESET_EMAIL", email)) {
      const { error } = await emailAuthClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error) console.error("Password recovery delivery:", error.code || "AUTH_DELIVERY_ERROR");
    }
  } catch { console.error("Password recovery delivery: SERVICE_UNAVAILABLE"); }
  // Hesabın olub-olmadığı və email xidmətinin daxili cavabı açıqlanmır.
  return { error: "", sent: true };
}
