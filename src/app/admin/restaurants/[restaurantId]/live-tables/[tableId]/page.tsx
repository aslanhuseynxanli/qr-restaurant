import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {ownerUUID} from "@/lib/owner-dashboard";
import {liveReturnQuery,parseDetailQuery} from "@/lib/live-tables";
import {readLiveDetail} from "@/lib/live-tables-read";
import LiveTablePanel from "./panel";
export default async function LiveTablePage({params,searchParams}:{params:Promise<{restaurantId:string;tableId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {restaurantId,tableId}=await params;if(!ownerUUID.test(restaurantId)||!ownerUUID.test(tableId))notFound();
  const query=await searchParams,backQuery=liveReturnQuery(query.back);
  const {filters,warning}=parseDetailQuery(query),result=await readLiveDetail(restaurantId,tableId,filters);
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  const root=`/admin/restaurants/${restaurantId}/live-tables`;
  return <main className="portal-page space-y-5">
    <Link prefetch={false} href={`${root}${backQuery?`?${backQuery}`:""}`} className="portal-btn">← Canlı masalara qayıt</Link>
    {result.data?<LiveTablePanel key={`${tableId}:${JSON.stringify(result.data.filters)}`} restaurantId={restaurantId} initialBoard={result.data} warning={warning} backQuery={backQuery}/>:<div role="alert" className="space-y-3 rounded-2xl bg-red-50 p-5 text-sm leading-6 text-red-800"><p>{result.error} İlk quraşdırmada 021_owner_live_tables.sql yeniləməsini tətbiq et.</p><Link prefetch={false} href={`${root}/${tableId}`} className="inline-flex min-h-11 items-center font-semibold">Yenidən aç</Link></div>}
  </main>;
}
