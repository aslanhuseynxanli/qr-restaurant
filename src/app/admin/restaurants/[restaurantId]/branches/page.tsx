import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {ownerUUID} from "@/lib/owner-dashboard";
import {readDashboardAction} from "../dashboard-actions";
import BranchForm from "../branch-form";
export default async function BranchesPage({params}:{params:Promise<{restaurantId:string}>}) {
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const result=await readDashboardAction(restaurantId,null);
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  if(!result.data)throw new Error("Filiallar yüklənmədi. 018 SQL yeniləməsini tətbiq et.");
  const board=result.data,root=`/admin/restaurants/${restaurantId}`;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={root} className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700">← Ümumi baxışa qayıt</Link>
    <header><h1 className="text-2xl font-bold">Filiallar</h1><p className="mt-2 break-words text-sm text-slate-500">{board.restaurant.name} · {board.branches.length} filial</p></header>
    <div className="grid items-start gap-6 lg:grid-cols-2"><section className="space-y-4">
      {!board.branches.length&&<p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-600">İlk filialını əlavə et. Sonra həmin filialda masaları və QR kodlarını yarada bilərsən.</p>}
      {board.branches.map(b=><article key={b.id} className="min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-5"><h2 className="break-words text-lg font-semibold">{b.name}</h2>{b.address&&<p className="break-words text-sm text-slate-500">{b.address}</p>}<p className="text-sm text-slate-500">{b.table_count} aktiv masa · Radius: {b.allowed_radius_meters} m</p><p className="text-xs font-medium text-emerald-800">{!b.is_active?"Deaktiv":b.accepting_orders?"Sifariş qəbulu açıqdır":"Sifariş qəbulu bağlıdır"}</p><div className="flex flex-wrap gap-2"><Link href={`${root}/branches/${b.id}`} className="inline-flex min-h-12 items-center rounded-xl border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-800">Masalar, QR və məkan</Link><Link href={`${root}/branches/${b.id}/orders`} className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Sifarişlər və çağırışlar</Link></div></article>)}
    </section>{board.restaurant.can_manage&&<BranchForm key={board.branches.length} restaurantId={restaurantId}/>}</div>
  </div></main>;
}
