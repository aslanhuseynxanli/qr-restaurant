import Link from "next/link";
import AuthShell from "@/components/auth-shell";
import VerifyRecoveryForm from "./form";
export const metadata = { title: "Şifrə bərpası · QR Restoran", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function RecoveryPage({ searchParams }: { searchParams: Promise<{ token_hash?: string | string[]; type?: string | string[] }> }) {
  const query = await searchParams, token = query.token_hash;
  const valid = typeof token === "string" && /^[a-f0-9]{40,128}$/i.test(token) && query.type === "recovery";
  return <AuthShell title="Şifrə bərpası" description="Şifrəni yeniləmək üçün davam et. Keçid yalnız bir dəfə istifadə olunur.">{valid ? <VerifyRecoveryForm token={token}/> : <div className="space-y-4"><p role="alert" className="text-sm text-red-700">Bərpa keçidi düzgün deyil. Emaildəki tam keçidi aç və ya yeni keçid istə.</p><Link href="/forgot-password" className="inline-block min-h-11 py-3 text-sm font-medium text-emerald-800">Yeni bərpa keçidi istə</Link></div>}</AuthShell>;
}
