"use server";
import { redirect } from "next/navigation";
import { accountSession, authLimit, currentAccount, finishPasswordChange } from "@/lib/account-security";
import { passwordError, type PasswordState } from "@/lib/account-password";

export async function changePassword(_previous: PasswordState, form: FormData): Promise<PasswordState> {
  const current = form.get("currentPassword"), password = form.get("password"), validation = passwordError(password, form.get("confirmation"));
  if (validation) return { error: validation };
  if (typeof current !== "string" || !current || current.length > 1024) return { error: "Hazırkı şifrəni yaz." };
  if (current === password) return { error: "Yeni şifrə hazırkı şifrədən fərqli olmalıdır." };
  let supabase;
  try {
    const account = await currentAccount();
    if (!account) return { error: "Hesab aktiv deyil və ya sessiya bitib. Yenidən daxil ol." };
    await accountSession(account);
    if (!await authLimit("CHANGE", account.user.id)) return { error: "Çox sayda cəhd edilib. Bir qədər sonra yenidən yoxla." };
    supabase = account.supabase;
    const { error } = await supabase.auth.updateUser({ password: password as string, current_password: current });
    if (error) return { error: "Şifrə dəyişdirilmədi. Hazırkı şifrəni yoxla. Yeniləməyə təkrar cəhd edirsənsə yeni şifrəni də yoxla." };
  } catch { return { error: "Cavab alınmadı. Hazırkı və yeni şifrə ilə giriş yoxla, sonra yenidən cəhd et." }; }
  await finishPasswordChange(supabase);
  redirect("/login?password=changed");
}
