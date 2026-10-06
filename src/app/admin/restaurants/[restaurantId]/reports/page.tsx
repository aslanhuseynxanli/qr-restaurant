import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {readOwnerRPC} from "@/lib/owner-read";
import {ownerUUID} from "@/lib/owner-dashboard";
import {parseSalesQuery,type SalesReport} from "@/lib/sales-report";
import ReportsPanel from "./panel";
export default async function ReportsPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const filters=parseSalesQuery(await searchParams);
  const result=await readOwnerRPC<SalesReport>("owner_sales_report",{p_restaurant_id:restaurantId,p_branch_id:filters.branch,p_from:filters.from,p_to:filters.to});
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700">← Ümumi baxışa qayıt</Link>
    <header><h1 className="text-2xl font-bold">Satış hesabatları</h1><p className="mt-2 break-words text-sm leading-6 text-slate-500">{result.data?.restaurant_name} · Bağlanmış hesablar əsasında satış və faktiki ödənişlər</p></header>
    {result.data?<ReportsPanel key={`${restaurantId}:${JSON.stringify(result.data.filters)}`} restaurantId={restaurantId} initialReport={result.data} warning={filters.warning}/>:<div role="alert" className="space-y-3 rounded-xl bg-red-50 p-5 text-sm leading-6 text-red-800"><p>{result.error} İlk quraşdırmada 020_owner_sales_reports.sql yeniləməsini tətbiq et.</p><Link href={`/admin/restaurants/${restaurantId}/reports`} className="inline-flex min-h-11 items-center font-semibold">Bugünkü hesabatı aç</Link></div>}
  </div></main>;
}
