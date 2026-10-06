import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {readOwnerRPC} from "@/lib/owner-read";
import {activityCategories,ownerUUID,validFilters,type ActivityCategory,type OwnerActivity} from "@/lib/owner-dashboard";
import ActivityPanel from "./panel";
export default async function ActivityPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const query=await searchParams;let warning=["branch","category","from","to"].some(name=>Array.isArray(query[name]))?"Filtrlər düzgün deyil. Cari seçimlə tarixçə göstərilir.":"";
  const get=(name:string)=>{const value=query[name];return typeof value==="string"?value:"";};
  let branch=get("branch")||null,category=get("category") as ActivityCategory|null||null;
  let from=get("from")||null,to=get("to")||null;
  if(branch&&!ownerUUID.test(branch)){branch=null;warning="Filial seçimi düzgün deyil. Bütün filiallar göstərilir.";}
  if(category&&!Object.hasOwn(activityCategories,category)){category=null;warning="Əməliyyat növü düzgün deyil. Bütün növlər göstərilir.";}
  if((from||to)&&!validFilters({branch_id:branch,category,from,to})){from=null;to=null;warning="Tarix aralığı düzgün deyil. Son 7 gün göstərilir; ən çox 366 gün seçilə bilər.";}
  const result=await readOwnerRPC<OwnerActivity>("owner_activity",{p_restaurant_id:restaurantId,p_branch_id:branch,p_category:category,p_from:from,p_to:to,p_before_at:null,p_before_id:null,p_limit:30});
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  if(!result.data)throw new Error("Tarixçə yüklənmədi. 018_owner_dashboard_and_activity.sql yeniləməsini tətbiq et.");
  const key=`${restaurantId}:${JSON.stringify(result.data.filters)}`;
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700">← Ümumi baxışa qayıt</Link>
    <header><h1 className="text-2xl font-bold">Fəaliyyət tarixçəsi</h1><p className="mt-2 break-words text-sm leading-6 text-slate-500">{result.data.restaurant_name} · Kim, nə vaxt və hansı əməliyyatı edib.</p></header>
    <ActivityPanel key={key} restaurantId={restaurantId} initialPage={result.data} warning={warning}/>
  </div></main>;
}
