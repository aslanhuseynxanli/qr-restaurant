import Link from "next/link";
import { notFound } from "next/navigation";
import { restaurantWorkspace } from "@/lib/workspace";
import { uuidPattern } from "@/lib/menu-management";
import type { StaffBoard } from "@/lib/qr-orders";
import OrdersPanel from "./panel";

export default async function OrdersPage({params}:{params:Promise<{restaurantId:string;branchId:string}>}) {
  const {restaurantId,branchId}=await params;
  if(!uuidPattern.test(restaurantId)||!uuidPattern.test(branchId))notFound();
  const {supabase,workspace}=await restaurantWorkspace(restaurantId);
  const branch=workspace.branches.find(b=>b.id===branchId)||workspace.assignments.find(b=>b.id===branchId&&b.restaurant_id===restaurantId);
  if(!branch)notFound();
  const board=await supabase.rpc("qr_staff_board",{p_restaurant_id:restaurantId,p_branch_id:branchId});
  if(board.error?.code==="42501")notFound();
  if(board.error||!board.data)throw new Error("Sifariş paneli yüklənmədi.");
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <header><h1 className="text-2xl font-semibold">Ofisiant paneli</h1><p className="mt-2 text-sm text-slate-500">{branch.name} · Sifarişlər, çağırışlar və hesablar.</p></header>
    {(board.data as StaffBoard).can_prepare===true&&<Link prefetch={false} href={`/admin/restaurants/${restaurantId}/branches/${branchId}/kitchen`} className="inline-flex min-h-12 items-center rounded-xl border border-emerald-200 bg-white px-4 py-3 text-sm font-semibold text-emerald-800">Mətbəx ekranını aç →</Link>}
    <OrdersPanel key={branchId} restaurantId={restaurantId} branchId={branchId} initialBoard={board.data as StaffBoard}/>
  </div></main>;
}
