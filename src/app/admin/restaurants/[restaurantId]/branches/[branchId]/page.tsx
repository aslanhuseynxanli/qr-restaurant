import {notFound} from "next/navigation";
import PortalLink from "@/components/portal-link";
import Disclosure from "@/components/disclosure";
import {requireMenuAdmin} from "@/lib/menu-admin";
import {BranchLocationForm,TableForm} from "./forms";
import TableQRList from "./table-qr";
import BulkTables from "./bulk-tables";
import BranchOrderAcceptance from "@/components/branch-order-acceptance";
export default async function BranchPage({params}:{params:Promise<{restaurantId:string;branchId:string}>}){
  const {restaurantId,branchId}=await params,{supabase,restaurant,branches,canManage}=await requireMenuAdmin(restaurantId),branch=branches.find(b=>b.id===branchId);
  if(!branch)notFound();
  const result=await supabase.from("tables").select("id,name,table_number,qr_token,is_active").eq("restaurant_id",restaurantId).eq("branch_id",branchId).order("table_number");
  if(result.error)throw new Error("Masalar yüklənmədi.");
  const tables=result.data||[],maxNumber=Math.max(0,...tables.map(t=>t.table_number)),suggestedNumber=maxNumber<2147483647?maxNumber+1:1;
  const root=`/admin/restaurants/${restaurantId}/branches/${branchId}`;
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-8"><header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-bold">Masalar və QR</h1><p className="mt-2 text-sm text-slate-500">{branch.name} · {tables.length} masa</p></div><PortalLink href={`${root}/orders`} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700">Ofisiant panelini aç</PortalLink></header>
    <BranchOrderAcceptance key={`${branch.id}:${branch.updated_at}`} branch={branch} canManage={canManage}/>
    {canManage&&branch.is_active&&<Disclosure title="Masa əlavə et" defaultOpen={!tables.length}><p className="mb-4 text-sm leading-6 text-slate-500">Bir neçə masa üçün sayını yaz. Hər masa QR kodu ilə birlikdə yaranır.</p><BulkTables restaurantId={restaurantId} branchId={branchId} suggestedNumber={suggestedNumber}/><Disclosure title="Tək masa əlavə et"><TableForm key={tables.length} restaurantId={restaurantId} branchId={branchId} suggestedNumber={suggestedNumber}/></Disclosure></Disclosure>}
    <TableQRList tables={tables} slug={restaurant.slug} printHref={`${root}/print`}/>
    {canManage&&<Disclosure title="Filialın məkanı və sifariş radiusu"><BranchLocationForm key={`${branch.latitude}:${branch.longitude}:${branch.allowed_radius_meters}`} restaurantId={restaurantId} branchId={branchId} latitude={Number(branch.latitude)} longitude={Number(branch.longitude)} address={branch.address} radius={branch.allowed_radius_meters}/></Disclosure>}
  </main>;
}
