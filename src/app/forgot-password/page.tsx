import AuthShell from "@/components/auth-shell";
import RecoveryRequestForm from "./form";
export const metadata = { title: "Şifrəni bərpa et · QR Restoran", robots: { index: false, follow: false } };
export default function ForgotPassword() {
  return <AuthShell title="Şifrəni bərpa et" description="Hesabının emailini yaz. Şifrəni yeniləmək üçün məktubdakı keçiddən istifadə et."><RecoveryRequestForm/></AuthShell>;
}
