import { redirect } from "next/navigation";
import { currentAccount } from "@/lib/account-security";
import AuthShell from "@/components/auth-shell";
import AccountForm from "./form";
export const metadata = { title: "Hesab ayarları · QR Restoran", robots: { index: false, follow: false } };

export default async function AccountPage() {
  const account = await currentAccount();
  if (!account) redirect("/login");
  return <AuthShell title="Hesab ayarları" description="Hazırkı şifrəni təsdiqləyərək yeni şifrə təyin et."><p className="mb-5 break-all rounded-xl bg-slate-50 p-4 text-sm text-slate-600">{account.user.email}</p><AccountForm/></AuthShell>;
}
