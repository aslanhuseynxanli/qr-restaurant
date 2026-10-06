import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {readOwnerRPC} from "@/lib/owner-read";
import {validFilters} from "@/lib/owner-dashboard";
import {accountMethods,accountUUID,type AccountHistory,type AccountMethod} from "@/lib/account-history";
import HistoryPanel from "./panel";
export default async function AccountsPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const {restaurantId}=await params;if(!accountUUID(restaurantId))notFound();
  const query=await searchParams;const get=(name:string)=>typeof query[name]==="string"?query[name] as string:"";
  let warning=["branch","method","from","to","q"].some(name=>Array.isArray(query[name]))?"Filtrlər düzgün deyil. Cari seçim göstərilir.":"";
  let branch=get("branch")||null,method=get("method") as AccountMethod|null||null,from=get("from")||null,to=get("to")||null,search=get("q").trim();
  if(branch&&!accountUUID(branch)){branch=null;warning="Filial seçimi düzgün deyil. Bütün filiallar göstərilir.";}
  if(method&&!Object.hasOwn(accountMethods,method)){method=null;warning="Ödəniş seçimi düzgün deyil. Bütün hesablar göstərilir.";}
  if(search.length>80){search="";warning="Axtarış ən çox 80 simvol ola bilər.";}
  if((from||to)&&!validFilters({branch_id:branch,category:null,from,to})){from=null;to=null;warning="Tarix aralığı düzgün deyil. Son 7 gün göstərilir; ən çox 366 gün seçilə bilər.";}
  const result=await readOwnerRPC<AccountHistory>("owner_account_history",{p_restaurant_id:restaurantId,p_branch_id:branch,p_method:method,p_from:from,p_to:to,p_search:search,p_before_at:null,p_before_id:null,p_limit:30});
  if(result.unauthenticated)redirect("/login");if(result.denied)notFound();
  if(!result.data)throw new Error("Hesab tarixçəsi yüklənmədi. 019_payments_and_account_history.sql yeniləməsini tətbiq et.");
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-emerald-700">← Ümumi baxışa qayıt</Link>
    <header><h1 className="text-2xl font-bold">Hesab tarixçəsi</h1><p className="mt-2 break-words text-sm leading-6 text-slate-500">{result.data.restaurant_name} · Bağlanmış masa hesabları və alınmış ödənişlər</p></header>
    <HistoryPanel key={`${restaurantId}:${JSON.stringify(result.data.filters)}`} restaurantId={restaurantId} initialPage={result.data} warning={warning}/>
  </div></main>;
}
