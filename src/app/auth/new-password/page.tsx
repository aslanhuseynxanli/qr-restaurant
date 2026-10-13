import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import { currentAccount, recoveryPermission } from "@/lib/account-security";
import NewPasswordForm from "./form";
export const metadata = { title: "Yeni şifrə · QR Restoran", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function NewPasswordPage() {
  let allowed = false;
  try { const account = await currentAccount(); allowed = !!account && await recoveryPermission(account); } catch { /* Təkrar bərpa yolu göstərilir. */ }
  return <AuthShell title="Yeni şifrə" description="Şifrə yenilənəndən sonra hesabına yenidən daxil ol.">{allowed ? <NewPasswordForm/> : <div className="space-y-4"><p role="alert" className="text-sm leading-6 text-slate-600">Bərpa icazəsi yoxdur, vaxtı bitib və ya artıq istifadə edilib. Az əvvəl şifrəni yeniləməyə cəhd etmisənsə yeni şifrə ilə giriş yoxla; alınmazsa yeni keçid istə.</p><div className="flex flex-wrap gap-x-5"><Link href="/login" className="min-h-11 py-3 text-sm font-semibold text-emerald-800">Girişə keç</Link><Link href="/forgot-password" className="min-h-11 py-3 text-sm font-semibold text-emerald-800">Yeni bərpa keçidi istə</Link></div></div>}</AuthShell>;
}
