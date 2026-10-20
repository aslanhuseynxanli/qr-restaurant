import {redirect} from "next/navigation";
import Link from "next/link";
import {Building2,Plus,UserRoundPlus,ArrowUpRight,ChefHat,BellRing} from "lucide-react";
import {PageHeading,Badge} from "@/components/portal-ui";
import WorkspaceShell from "@/components/workspace-shell";
import {getWorkspace} from "@/lib/workspace";
import {assignmentPath} from "@/lib/workspace-types";
import OperationsHealth from "./operations-health";
import PlatformPanel from "./platform-panel";
import type {PlatformBoard} from "@/lib/restaurant-operations";
export default async function AdminPage({searchParams}:{searchParams:Promise<{secim?:string;view?:string}>}){
 const {workspace,userId,supabase}=await getWorkspace(),query=await searchParams,ownersOnly=query.view==="owners";
 if(workspace.active&&!workspace.super_admin&&query.secim!=="1"){if(workspace.restaurants.length===1)redirect(`/admin/restaurants/${workspace.restaurants[0].id}`);if(!workspace.restaurants.length&&workspace.assignments.length===1)redirect(assignmentPath(workspace.assignments[0]));}
 let board:PlatformBoard|null=null;if(workspace.active&&workspace.super_admin){const result=await supabase.rpc("platform_restaurants_board",{p_search:null,p_status:null,p_limit:30});if(result.error||!result.data)throw new Error("Platforma paneli yüklənmədi. 027 yeniləməsini yoxla.");board=result.data as PlatformBoard;}
 return <WorkspaceShell workspace={workspace} userId={userId}><main className="portal-page space-y-6"><PageHeading eyebrow={workspace.super_admin?"Platforma admini":"İş sahəsi"} title={board?ownersOnly?"Sahib hesabları":"Restoranların idarə edilməsi":"İş yerini seç"} description={board?"Restoranları qoş, sahib hesablarını yarat və giriş statuslarını idarə et.":`Xoş gəldin${workspace.name?`, ${workspace.name}`:""}. İşləyəcəyin restoranı və ya filialı aç.`} actions={board?<><Link href="/admin?view=owners" className="portal-btn"><UserRoundPlus size={15}/>Sahib hesabı yarat</Link><Link href="/admin/restaurants/new" className="portal-btn portal-btn-primary"><Plus size={16}/>Restoran əlavə et</Link></>:null}/>
 {!workspace.active?<p role="alert" className="portal-notice portal-notice-warning">Bu hesab aktiv deyil. Restoran sahibi və ya platforma admini ilə əlaqə saxla.</p>:board?<><OperationsHealth/><PlatformPanel key={ownersOnly?"owners":"restaurants"} initialBoard={board} ownersOnly={ownersOnly}/></>:<>
 {!!workspace.restaurants.length&&<section className="portal-grid-2">{workspace.restaurants.map(r=><article key={r.id} className="portal-panel space-y-4"><Building2 className="text-emerald-600" size={25}/><h2 className="text-lg font-bold">{r.name}</h2><Badge tone="teal">Restoran sahibi</Badge><p className="portal-help">{workspace.branches.filter(b=>b.restaurant_id===r.id).length} filial</p><Link href={`/admin/restaurants/${r.id}`} className="portal-btn portal-btn-primary">İdarəetməni aç<ArrowUpRight size={14}/></Link></article>)}</section>}
 {!!workspace.assignments.length&&<section className="portal-grid-2">{workspace.assignments.map(a=><article key={a.id} className="portal-panel space-y-4">{a.staff_kind==="KITCHEN"?<ChefHat className="text-emerald-700"/>:<BellRing className="text-amber-600"/>}<div><p className="portal-help">{a.restaurant_name}</p><h2 className="mt-2 text-lg font-bold">{a.name}</h2></div><Link href={assignmentPath(a)} className="portal-btn portal-btn-primary">{a.staff_kind==="KITCHEN"?"Mətbəxi aç":"Ofisiant panelini aç"}<ArrowUpRight size={14}/></Link></article>)}</section>}
 {!workspace.restaurants.length&&!workspace.assignments.length&&<p role="alert" className="portal-notice portal-notice-warning">Bu hesaba aktiv iş yeri təyin edilməyib. Restoran sahibi ilə əlaqə saxla.</p>}
 </>}
 </main></WorkspaceShell>;
}
