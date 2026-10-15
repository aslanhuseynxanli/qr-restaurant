"use client";
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {useParams,usePathname,useRouter,useSearchParams} from "next/navigation";
import Link from "next/link";
import {LayoutDashboard,UtensilsCrossed,Grid2X2,Users,ChartNoAxesCombined,History,MapPin,ChefHat,BellRing,Menu,X,Settings,LogOut,Building2,QrCode,UserRoundPlus,Plus,Ellipsis} from "lucide-react";
import PortalLink from "./portal-link";
import {signOutAction} from "@/app/login/actions";
import {assignmentPath,type Workspace} from "@/lib/workspace-types";
const subscribe=(notify:()=>void)=>{window.addEventListener("storage",notify);return()=>window.removeEventListener("storage",notify);};
function stored(key:string){try{return localStorage.getItem(key)||"";}catch{return "";}}
export default function WorkspaceShell({workspace,userId,restaurantId,children}:{workspace:Workspace;userId:string;restaurantId?:string;children:ReactNode}){
  const pathname=usePathname(),params=useParams(),query=useSearchParams(),router=useRouter(),drawer=useRef<HTMLDialogElement>(null);
  const restaurant=workspace.restaurants.find(r=>r.id===restaurantId),platform=workspace.super_admin,owner=!!restaurant&&!platform;
  const assignment=workspace.assignments.find(a=>a.restaurant_id===restaurantId&&a.id===params.branchId),worker=!platform&&!owner&&!!assignment;
  const root=restaurantId?`/admin/restaurants/${restaurantId}`:"/admin",branches=workspace.branches.filter(b=>b.restaurant_id===restaurantId),first=branches.find(b=>b.is_active)?.id||branches[0]?.id||"";
  const key=`qr-workspace:${userId}:${restaurantId||"platform"}`,remembered=useSyncExternalStore(subscribe,()=>stored(key),()=>""),[selection,setSelection]=useState<{key:string;id:string}|null>(null);
  const saved=selection?.key===key?selection.id:remembered,preferred=branches.some(b=>b.id===saved)?saved:first;
  const aggregate=pathname===root||["live-tables","reports","accounts","activity"].some(p=>pathname===`${root}/${p}`),fromQuery=query.get("branch")||"",routeBranch=typeof params.branchId==="string"?params.branchId:"";
  const branchId=branches.some(b=>b.id===routeBranch)?routeBranch:branches.some(b=>b.id===fromQuery)?fromQuery:aggregate?"":preferred;
  const navBranch=branchId||preferred,branchRoot=navBranch?`${root}/branches/${navBranch}`:`${root}/branches`;
  const currentBranch=branches.find(b=>b.id===branchId);
  useEffect(()=>{drawer.current?.close();},[pathname,query]);
  function chooseBranch(id:string){
    if(id&&!branches.some(b=>b.id===id)||!id&&!aggregate)return;
    if(id){setSelection({key,id});try{localStorage.setItem(key,id);}catch{}}
    const match=pathname.match(/\/branches\/[a-f0-9-]+(\/.*)?$/i),next=new URLSearchParams(query.toString());
    if(match){next.delete("branch");router.push(`${root}/branches/${id}${match[1]||""}${next.size?`?${next}`:""}`);}
    else if(aggregate){if(id)next.set("branch",id);else next.delete("branch");router.push(`${pathname}${next.size?`?${next}`:""}`);}
  }
  const branchQuery=branchId?`?branch=${branchId}`:"";
  const main=platform?[
    {href:"/admin",label:"Restoranlar",icon:Building2},
    {href:"/admin?view=owners",label:"Sahib hesabları",icon:Users},
    {href:"/admin/restaurants/new",label:"Restoran əlavə et",icon:Plus},
    ...(restaurantId?[{href:`${root}/owners`,label:"Seçilmiş restoranın sahibi",icon:UserRoundPlus}]:[]),
  ]:owner?[
    {href:root,label:"Ümumi baxış",icon:LayoutDashboard},{href:`${root}/live-tables${branchQuery}`,label:"Canlı masalar",icon:Grid2X2},{href:`${root}/menu`,label:"Menyu",icon:UtensilsCrossed},
    {href:`${root}/reports${branchQuery}`,label:"Hesabatlar",icon:ChartNoAxesCombined},{href:`${root}/accounts${branchQuery}`,label:"Hesab tarixçəsi",icon:History},
  ]:assignment?[{href:assignmentPath(assignment),label:assignment.staff_kind==="KITCHEN"?"Mətbəx paneli":"Ofisiant paneli",icon:assignment.staff_kind==="KITCHEN"?ChefHat:BellRing}]:[{href:"/admin?secim=1",label:"İş yerləri",icon:Building2}];
  const operations=owner?[
    ...(navBranch?[{href:`${branchRoot}/orders`,label:"Ofisiant paneli",icon:BellRing},{href:`${branchRoot}/kitchen`,label:"Mətbəx paneli",icon:ChefHat},{href:branchRoot,label:"Masalar və QR",icon:QrCode}]:[]),
    {href:`${root}/branches`,label:"Filiallar və məkan",icon:MapPin},{href:`${root}/staff`,label:"Komanda",icon:Users},{href:`${root}/activity${branchQuery}`,label:"Fəaliyyət tarixçəsi",icon:History},
  ]:[];
  function active(href:string){const [path,search=""]=href.split("?");if(platform&&path==="/admin")return pathname==="/admin"&&(new URLSearchParams(search).get("view")==="owners"?query.get("view")==="owners":query.get("view")!=="owners");if(path===root)return pathname===path;return pathname===path||!path.endsWith(navBranch)&&pathname.startsWith(path+"/");}
  function item(link:(typeof main)[number]){return <PortalLink key={link.href} href={link.href} aria-current={active(link.href)?"page":undefined} className="portal-nav-link"><link.icon size={18}/><span>{link.label}</span></PortalLink>;}
  const role=platform?"Platforma admini":owner||workspace.restaurants.length?"Restoran sahibi":assignment?.staff_kind==="KITCHEN"?"Mətbəx":"Ofisiant";
  const title=platform?restaurant?.name||"Platformanın idarə edilməsi":restaurant?.name||assignment?.restaurant_name||"İş yeri seçimi",name=workspace.name||role,initials=name.split(/\s+/).slice(0,2).map(p=>p[0]).join("").toLocaleUpperCase("az");
  const navigation=<div className="portal-sidebar-inner"><Link href="/admin" className="portal-brand"><span className="portal-brand-mark">QR</span><span><strong>QR Restoran<span className="text-emerald-300">.</span></strong><small>{platform?"PLATFORMA":worker?"İŞ EKRANI":"İDARƏETMƏ"}</small></span></Link><nav className="portal-nav" aria-label="Əsas bölmələr"><p className="portal-nav-label">{platform?"Platforma":"İş sahəsi"}</p>{main.map(item)}{!!operations.length&&<><p className="portal-nav-label">İdarəetmə</p>{operations.map(item)}</>}</nav><footer className="portal-nav-footer">{!platform&&workspace.restaurants.length+workspace.assignments.length>1&&<PortalLink href="/admin?secim=1" className="portal-nav-link"><Building2 size={18}/>İş yerini dəyiş</PortalLink>}<div className="portal-user"><span className="portal-avatar">{initials}</span><div className="min-w-0"><strong>{name}</strong><small>{role}</small></div></div><div className="portal-user-actions"><Link href="/admin/account"><Settings size={13}/>Hesab ayarları</Link><form action={signOutAction}><button title="Hesabdan çıx" aria-label="Çıxış"><LogOut size={14}/></button></form></div></footer></div>;
  const bottom=platform?main.slice(0,3):owner?main.slice(0,4):[];
  return <div className={`portal ${worker?"portal-work":""} ${platform?"portal-admin":owner?"portal-owner":assignment?.staff_kind==="KITCHEN"?"portal-kitchen":"portal-waiter"}`}><a href="#portal-content" className="portal-skip">Məzmuna keç</a>{!worker&&<aside className="portal-sidebar">{navigation}</aside>}<div className="portal-body"><header className="portal-topbar"><div className="portal-topbar-start"><button type="button" aria-label="Bölmələri aç" onClick={()=>drawer.current?.showModal()} className="portal-menu-button"><Menu size={19}/></button>{worker&&<Link href={assignmentPath(assignment)} className="portal-brand-mark">QR</Link>}<div><p className="portal-topbar-title">{title}</p><p className="portal-topbar-caption">{role}{assignment?` · ${assignment.name}`:owner&&currentBranch?` · ${currentBranch.name}`:""}</p></div></div><div className="portal-topbar-end">{worker?<span className="portal-work-role">{assignment.staff_kind==="KITCHEN"?<ChefHat size={13}/>:<BellRing size={13}/>}İş ekranı</span>:<span className="portal-live-indicator"><span/>İş sahəsi</span>}
    {owner&&branches.length>0&&<label className="portal-branch-select"><MapPin size={15}/><select aria-label="Aktiv filial" value={branchId} onChange={e=>chooseBranch(e.target.value)}>{aggregate&&<option value="">Bütün filiallar</option>}{branches.map(b=><option key={b.id} value={b.id}>{b.name}{b.is_active?"":" (deaktiv)"}</option>)}</select></label>}
    {!owner&&!platform&&workspace.assignments.length>1&&<label className="portal-branch-select"><select aria-label="İş yerini seç" value={assignment?.id||""} onChange={e=>{const a=workspace.assignments.find(a=>a.id===e.target.value);if(a)router.push(assignmentPath(a));}}><option value="" disabled>İş yerini seç</option>{workspace.assignments.map(a=><option key={a.id} value={a.id}>{a.restaurant_name} · {a.name}</option>)}</select></label>}
    <Link href="/admin/account" aria-label="Hesab ayarları" className="portal-top-account"><Settings size={16}/></Link></div></header><div id="portal-content" className="portal-content" tabIndex={-1}>{children}</div></div>
    <dialog ref={drawer} aria-label="Bölmələr" className="portal-drawer" onClick={e=>{if(e.target===e.currentTarget)drawer.current?.close();}}><button type="button" aria-label="Bölmələri bağla" className="portal-drawer-close" onClick={()=>drawer.current?.close()}><X size={17}/></button>{navigation}</dialog>
    {!!bottom.length&&<nav aria-label="Mobil bölmələr" className="portal-mobile-nav">{bottom.map(l=><Link key={l.href} href={l.href} aria-current={active(l.href)?"page":undefined}><l.icon size={18}/><span>{l.label}</span></Link>)}<button type="button" aria-label="Digər bölmələri aç" onClick={()=>drawer.current?.showModal()}><Ellipsis size={18}/><span>Daha çox</span></button></nav>}
  </div>;
}
