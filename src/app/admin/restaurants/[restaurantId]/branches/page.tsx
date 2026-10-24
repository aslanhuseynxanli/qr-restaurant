import PortalLink from "@/components/portal-link";
import {requireMenuAdmin} from "@/lib/menu-admin";
import Disclosure from "@/components/disclosure";
import BranchForm from "../branch-form";
import BranchOrderAcceptance from "@/components/branch-order-acceptance";
export default async function BranchesPage({params}:{params:Promise<{restaurantId:string}>}){
  const {restaurantId}=await params,{restaurant,branches,canManage}=await requireMenuAdmin(restaurantId),root=`/admin/restaurants/${restaurantId}`;
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-8"><header><h1 className="text-2xl font-bold">Filiallar və məkan</h1><p className="mt-2 text-sm text-slate-500">{restaurant.name} · {branches.length} filial</p></header>
    <div className="grid items-start gap-6 xl:grid-cols-[1fr_380px]"><section className="space-y-4">{!branches.length&&<p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">İlk filialını əlavə et. Sonra masaları yarat və QR-ləri çap et.</p>}{branches.map(b=><article key={b.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">{b.name}</h2><p className="mt-1 text-sm text-slate-500">{b.address||"Ünvan qeyd edilməyib"}</p></div><span className="rounded-lg bg-slate-100 px-3 py-2 text-xs">{b.table_count} masa</span></div><BranchOrderAcceptance key={`${b.id}:${b.updated_at}`} branch={b} canManage={canManage}/><div className="grid gap-2 sm:grid-cols-2"><PortalLink href={`${root}/branches/${b.id}`} className="rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Masalar, QR və məkan</PortalLink><PortalLink href={`${root}/branches/${b.id}/orders`} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-700">Ofisiant paneli</PortalLink></div></article>)}</section>
    {canManage&&<Disclosure title="Yeni filial əlavə et" defaultOpen={!branches.length}><BranchForm key={branches.length} restaurantId={restaurantId}/></Disclosure>}</div>
  </main>;
}
