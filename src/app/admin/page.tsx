import {redirect} from "next/navigation";
import PortalLink from "@/components/portal-link";
import WorkspaceShell from "@/components/workspace-shell";
import {getWorkspace} from "@/lib/workspace";
import {assignmentPath} from "@/lib/workspace-types";
import PlatformPanel from "./platform-panel";
import type {PlatformBoard} from "@/lib/restaurant-operations";
export default async function AdminPage({searchParams}:{searchParams:Promise<{secim?:string}>}){
  const {workspace,userId,supabase}=await getWorkspace(),query=await searchParams;
  if(workspace.active&&!workspace.super_admin&&query.secim!=="1"){
    if(workspace.restaurants.length===1)redirect(`/admin/restaurants/${workspace.restaurants[0].id}`);
    if(!workspace.restaurants.length&&workspace.assignments.length===1)redirect(assignmentPath(workspace.assignments[0]));
  }
  let board:PlatformBoard|null=null;
  if(workspace.active&&workspace.super_admin){const result=await supabase.rpc("platform_restaurants_board",{p_search:null,p_status:null,p_limit:30});if(result.error||!result.data)throw new Error("Platforma paneli yüklənmədi.");board=result.data as PlatformBoard;}
  return <WorkspaceShell workspace={workspace} userId={userId}><main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-8"><header><p className="text-sm font-medium text-emerald-700">Xoş gəldin{workspace.name?`, ${workspace.name}`:""}</p><h1 className="mt-2 text-2xl font-bold">{board?"Restoranların idarə edilməsi":"İş yerini seç"}</h1><p className="mt-2 text-sm leading-6 text-slate-500">{board?"Restoran tap, sahib hesabını və statusunu idarə et.":"İşləyəcəyin restoranı və ya filialı aç."}</p></header>
    {!workspace.active?<p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Bu hesab aktiv deyil. Restoran sahibi və ya platforma admini ilə əlaqə saxla.</p>:board?<PlatformPanel initialBoard={board}/>:<>
      {!!workspace.restaurants.length&&<section className="grid gap-4 md:grid-cols-2">{workspace.restaurants.map(r=><article key={r.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><div><h2 className="text-xl font-bold">{r.name}</h2><p className="mt-2 text-sm text-slate-500">{workspace.branches.filter(b=>b.restaurant_id===r.id).length} filial · Restoran sahibi</p></div><PortalLink href={`/admin/restaurants/${r.id}`} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">İdarəetməni aç</PortalLink></article>)}</section>}
      {!!workspace.assignments.length&&<section className="grid gap-4 md:grid-cols-2">{workspace.assignments.map(a=><article key={a.restaurant_id+":"+a.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><div><p className="text-sm text-slate-500">{a.restaurant_name}</p><h2 className="mt-2 text-xl font-bold">{a.name}</h2></div><PortalLink href={assignmentPath(a)} className="rounded-xl bg-emerald-800 px-4 py-3 font-semibold text-white">{a.staff_kind==="KITCHEN"?"Mətbəxi aç":"Ofisiant panelini aç"}</PortalLink></article>)}</section>}
      {!workspace.restaurants.length&&!workspace.assignments.length&&<p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Bu hesaba aktiv iş yeri təyin edilməyib. Restoran sahibi ilə əlaqə saxla.</p>}
    </>}
  </main></WorkspaceShell>;
}
