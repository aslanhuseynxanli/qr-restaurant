import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {readOwnerRPC} from "@/lib/owner-read";
import {accountUUID,type AccountDetail} from "@/lib/account-history";
import AccountPanel from "./panel";
export default async function AccountPage({params}:{params:Promise<{restaurantId:string;sessionId:string}>}) {
  const {restaurantId,sessionId}=await params;if(!accountUUID(restaurantId)||!accountUUID(sessionId))notFound();
  const result=await readOwnerRPC<AccountDetail>("owner_account_detail",{p_restaurant_id:restaurantId,p_session_id:sessionId});
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  if(!result.data)throw new Error("Hesab detalları yüklənmədi. Yenidən cəhd et.");
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-4xl space-y-5">
    <Link href={`/admin/restaurants/${restaurantId}/accounts`} className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700">← Hesab tarixçəsinə qayıt</Link>
    <AccountPanel restaurantId={restaurantId} initialDetail={result.data}/>
  </div></main>;
}
