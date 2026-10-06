import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {staffUUID,type StaffManagementBoard} from "@/lib/staff-management";
import StaffPanel from "./panel";

export default async function StaffPage({params}:{params:Promise<{restaurantId:string}>}) {
  const {restaurantId}=await params;if(!staffUUID.test(restaurantId))notFound();
  const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user)redirect("/login");
  const {data,error}=await supabase.rpc("staff_management_board",{p_restaurant_id:restaurantId});
  if(error?.code==="42501")notFound();
  if(error||!data)throw new Error("İşçi siyahısı yüklənmədi. 015_staff_management.sql yeniləməsini tətbiq et.");
  const board=data as StaffManagementBoard;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}`} className="text-sm font-medium text-emerald-700">← Filiallara qayıt</Link>
    <header><h1 className="text-2xl font-semibold">İşçilər</h1><p className="mt-2 text-sm text-slate-500">{board.restaurant_name} · Hər işçi təyin olunduğu filialın sifarişlərini və çağırışlarını idarə edir.</p></header>
    <StaffPanel restaurantId={restaurantId} board={board}/>
  </div></main>;
}
