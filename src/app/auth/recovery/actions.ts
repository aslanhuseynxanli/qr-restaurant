"use server";
import { redirect } from "next/navigation";
import { authLimit, clearRecovery, currentAccount, finishPasswordChange, openRecovery, recoveryPermission, requestIp } from "@/lib/account-security";
import { passwordError, type PasswordState } from "@/lib/account-password";
import { createClient } from "@/lib/supabase/server";

export async function verifyRecovery(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const token = form.get("token_hash");
  if (typeof token !== "string" || !/^[a-f0-9]{40,128}$/i.test(token) || form.get("type") !== "recovery") return { error: "Bərpa keçidi düzgün deyil. Yeni keçid istə." };
  try {
    if (!await authLimit("VERIFY", await requestIp())) return { error: "Çox sayda cəhd edilib. Bir qədər sonra yenidən yoxla." };
    await clearRecovery();
    const supabase = await createClient(12000);
    const { error } = await supabase.auth.verifyOtp({ token_hash: token, type: "recovery" });
    if (error) return { error: "Bu keçidin vaxtı bitib və ya artıq istifadə edilib. Yeni keçid istə." };
    const account = await currentAccount();
    if (!account) { await supabase.auth.signOut({ scope: "local" }); return { error: "Hesab aktiv deyil. Adminlə əlaqə saxla." }; }
    await openRecovery(account);
  } catch { return { error: "Bərpa alınmadı. Yeni keçid istəyib yenidən yoxla." }; }
  redirect("/auth/new-password");
}

export async function resetPassword(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const validation = passwordError(form.get("password"), form.get("confirmation"));
  if (validation) return { error: validation };
  let supabase;
  try {
    const account = await currentAccount();
    if (!account || !await recoveryPermission(account)) return { error: "Bərpa icazəsinin vaxtı bitib və ya artıq istifadə edilib. Yeni keçid istə.", retry: true };
    if (!await authLimit("CHANGE", account.user.id)) return { error: "Çox sayda cəhd edilib. Bir qədər sonra yenidən yoxla." };
    if (!await recoveryPermission(account, true)) return { error: "Bu bərpa cəhdi artıq istifadə edilib. Yeni keçid istə.", retry: true };
    supabase = account.supabase;
    // İcazə provayder əməliyyatından əvvəl bir dəfə istifadə olunur.
    // Cookie uğursuz cavabda saxlanılır ki, formdakı izah RSC yenilənməsində itməsin.
    const { error } = await supabase.auth.updateUser({ password: form.get("password") as string });
    if (error) return { error: "Şifrə yeniləməsi təsdiqlənmədi. Yeni şifrə ilə giriş yoxla; alınmazsa yeni bərpa keçidi istə.", retry: true };
  } catch { return { error: "Cavab alınmadı. Yeni şifrə ilə giriş yoxla; alınmazsa yeni bərpa keçidi istə.", retry: true }; }
  await finishPasswordChange(supabase);
  redirect("/login?password=changed");
}
