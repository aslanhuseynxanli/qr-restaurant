import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {ownerUUID,type OwnerManagementBoard} from "@/lib/owner-management";
import OwnerPanel from "./panel";

export default async function OwnersPage({params}:{params:Promise<{restaurantId:string}>}) {
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user)redirect("/login");
  const {data,error}=await supabase.rpc("owner_management_board",{p_restaurant_id:restaurantId});
  if(error?.code==="42501")notFound();
  if(error||!data)throw new Error("Sahib siyahısı yüklənmədi. 017_owner_management.sql yeniləməsini tətbiq et.");
  const board=data as OwnerManagementBoard;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href="/admin" className="text-sm font-medium text-emerald-700">← Restoranlara qayıt</Link>
    <header><h1 className="text-2xl font-semibold">Restoran sahibinin hesabı</h1><p className="mt-2 text-sm leading-6 text-slate-500">{board.restaurant_name} · Sahib bu restoranın filiallarını, masalarını, menyusunu və işçilərini idarə edir.</p></header>
    <OwnerPanel restaurantId={restaurantId} board={board}/>
  </div></main>;
}
