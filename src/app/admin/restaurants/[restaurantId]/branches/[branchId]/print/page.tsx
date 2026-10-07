import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {ownerUUID} from "@/lib/owner-management";
import {publicOrigin} from "@/lib/qr-url";
import QRPrint from "./qr-print";
export default async function PrintPage({params,searchParams}:{params:Promise<{restaurantId:string;branchId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {restaurantId,branchId}=await params,q=await searchParams;if(!ownerUUID.test(restaurantId)||!ownerUUID.test(branchId))notFound();
  const supabase=await createClient(),auth=await supabase.auth.getUser();if(auth.error||!auth.data.user)redirect("/login");
  const [profile,platform,member,restaurant,branch,tables]=await Promise.all([
    supabase.from("profiles").select("is_active").eq("id",auth.data.user.id).maybeSingle(),
    supabase.from("platform_admins").select("role").eq("user_id",auth.data.user.id).eq("is_active",true).maybeSingle(),
    supabase.from("restaurant_members").select("role").eq("user_id",auth.data.user.id).eq("restaurant_id",restaurantId).eq("role","RESTAURANT_ADMIN").eq("is_active",true).maybeSingle(),
    supabase.from("restaurants").select("name,slug").eq("id",restaurantId).maybeSingle(),
    supabase.from("branches").select("name").eq("id",branchId).eq("restaurant_id",restaurantId).maybeSingle(),
    supabase.from("tables").select("id,name,table_number,qr_token").eq("restaurant_id",restaurantId).eq("branch_id",branchId).eq("is_active",true).order("table_number")]);
  if([profile,platform,member,restaurant,branch,tables].some(r=>r.error))throw new Error("QR məlumatları yüklənmədi.");
  if(!profile.data?.is_active||!(platform.data?.role==="SUPER_ADMIN"||member.data?.role==="RESTAURANT_ADMIN")||!restaurant.data||!branch.data)notFound();
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-5xl space-y-5"><Link href={`/admin/restaurants/${restaurantId}/branches/${branchId}`} className="qr-screen-only inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Masalar və QR</Link><QRPrint tables={tables.data||[]} restaurant={restaurant.data.name} branch={branch.data.name} slug={restaurant.data.slug} initialOrigin={typeof q.origin==="string"?publicOrigin(q.origin)||"":""}/></div></main>;
}
