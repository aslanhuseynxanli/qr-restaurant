import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {uuidPattern} from "@/lib/menu-management";
import {parseKitchenQuery} from "@/lib/kitchen";
import {readKitchen} from "@/lib/kitchen-read";
import KitchenPanel from "./panel";
export default async function KitchenPage({params,searchParams}:{params:Promise<{restaurantId:string;branchId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}){
  const {restaurantId,branchId}=await params;if(!uuidPattern.test(restaurantId)||!uuidPattern.test(branchId))notFound();
  const {filters,warning}=parseKitchenQuery(await searchParams),result=await readKitchen(restaurantId,branchId,filters);
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-7xl space-y-5">
    <Link prefetch={false} href="/admin" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">← Panelə qayıt</Link>
    {result.data?<KitchenPanel key={JSON.stringify(result.data.filters)} restaurantId={restaurantId} branchId={branchId} initialBoard={result.data} warning={warning}/>:<div role="alert" className="space-y-3 rounded-xl bg-red-50 p-5 text-sm leading-6 text-red-800"><p>{result.error} İlk quraşdırmada 022_kitchen_screen.sql yeniləməsini tətbiq et.</p><Link prefetch={false} href={`/admin/restaurants/${restaurantId}/branches/${branchId}/kitchen`} className="inline-flex min-h-11 items-center font-semibold">Yenidən aç</Link></div>}
  </div></main>;
}
