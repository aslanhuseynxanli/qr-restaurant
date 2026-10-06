import Link from "next/link";
import { notFound,redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uuidPattern } from "@/lib/menu-management";
import type { StaffBoard } from "@/lib/qr-orders";
import OrdersPanel from "./panel";
import {signOutAction} from "@/app/login/actions";

export default async function OrdersPage({params}:{params:Promise<{restaurantId:string;branchId:string}>}) {
  const {restaurantId,branchId}=await params;
  if(!uuidPattern.test(restaurantId)||!uuidPattern.test(branchId))notFound();
  const supabase=await createClient();
  const {data:auth,error:authError}=await supabase.auth.getUser();
  if(authError||!auth.user)redirect("/login");
  const [board,branch]=await Promise.all([
    supabase.rpc("qr_staff_board",{p_restaurant_id:restaurantId,p_branch_id:branchId}),
    supabase.from("branches").select("name").eq("id",branchId).eq("restaurant_id",restaurantId).maybeSingle(),
  ]);
  if(board.error?.code==="42501"||!branch.data&&!branch.error)notFound();
  if(board.error||branch.error||!board.data)throw new Error("Sifariş paneli yüklənmədi. 013 SQL yeniləməsinin tətbiq edildiyini yoxla.");
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <div className="flex items-center justify-between gap-3"><Link href="/admin" className="text-sm font-medium text-emerald-700">← Panelə qayıt</Link><form action={signOutAction}><button className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm">Çıxış</button></form></div>
    <header><h1 className="text-2xl font-semibold">Sifarişlər və masa çağırışları</h1><p className="mt-2 text-sm text-slate-500">{branch.data?.name} · Hər telefonun sifarişi ayrı, hesab masa üzrədir.</p></header>
    <Link prefetch={false} href={`/admin/restaurants/${restaurantId}/branches/${branchId}/kitchen`} className="inline-flex min-h-12 items-center rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800">Mətbəx ekranını aç →</Link>
    <OrdersPanel restaurantId={restaurantId} branchId={branchId} initialBoard={board.data as StaffBoard}/>
  </div></main>;
}
