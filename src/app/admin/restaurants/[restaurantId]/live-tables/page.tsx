import Link from "next/link";
import {PageHeading} from "@/components/portal-ui";
import {notFound,redirect} from "next/navigation";
import {ownerUUID} from "@/lib/owner-dashboard";
import {parseLiveQuery} from "@/lib/live-tables";
import {readLiveTables} from "@/lib/live-tables-read";
import LiveTablesPanel from "./panel";
export default async function LiveTablesPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const {filters,warning}=parseLiveQuery(await searchParams),result=await readLiveTables(restaurantId,filters);
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  return <main className="portal-page space-y-6">
    <PageHeading eyebrow="Masa idarəsi" title="Canlı masalar" description="Hər masanın vəziyyəti, hazır sifarişləri və çağırışları bir baxışda."/>
    {result.data?<LiveTablesPanel key={JSON.stringify(result.data.filters)} restaurantId={restaurantId} initialBoard={result.data} warning={warning}/>:<div role="alert" className="space-y-3 rounded-2xl bg-red-50 p-5 text-sm leading-6 text-red-800"><p>{result.error} İlk quraşdırmada 021_owner_live_tables.sql yeniləməsini tətbiq et.</p><Link prefetch={false} href={`/admin/restaurants/${restaurantId}/live-tables`} className="inline-flex min-h-11 items-center font-semibold">Yenidən aç</Link></div>}
  </main>;
}
