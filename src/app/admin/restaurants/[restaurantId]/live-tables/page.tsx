import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {ownerUUID} from "@/lib/owner-dashboard";
import {parseLiveQuery} from "@/lib/live-tables";
import {readLiveTables} from "@/lib/live-tables-read";
import LiveTablesPanel from "./panel";
export default async function LiveTablesPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const {filters,warning}=parseLiveQuery(await searchParams),result=await readLiveTables(restaurantId,filters);
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-5">
    <Link prefetch={false} href={`/admin/restaurants/${restaurantId}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Ümumi baxışa qayıt</Link>
    <header><h1 className="text-2xl font-bold">Canlı masalar</h1><p className="mt-2 text-sm leading-6 text-slate-500">Filialların masaları, sifarişləri və çağırışları bir yerdə</p></header>
    {result.data?<LiveTablesPanel key={JSON.stringify(result.data.filters)} restaurantId={restaurantId} initialBoard={result.data} warning={warning}/>:<div role="alert" className="space-y-3 rounded-2xl bg-red-50 p-5 text-sm leading-6 text-red-800"><p>{result.error} İlk quraşdırmada 021_owner_live_tables.sql yeniləməsini tətbiq et.</p><Link prefetch={false} href={`/admin/restaurants/${restaurantId}/live-tables`} className="inline-flex min-h-11 items-center font-semibold">Yenidən aç</Link></div>}
  </div></main>;
}
