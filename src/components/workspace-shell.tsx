"use client";
import {useEffect,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {useParams,usePathname,useRouter} from "next/navigation";
import Link from "next/link";
import {LayoutDashboard,UtensilsCrossed,Grid2X2,Users,ChartNoAxesCombined,History,MapPin,ChefHat,BellRing,Menu,X,Settings,LogOut,Building2,QrCode} from "lucide-react";
import PortalLink from "./portal-link";
import {signOutAction} from "@/app/login/actions";
import {assignmentPath,type Workspace} from "@/lib/workspace-types";

const subscribeStorage=(notify:()=>void)=>{window.addEventListener("storage",notify);return()=>window.removeEventListener("storage",notify);};
function storedBranch(key:string){try{return localStorage.getItem(key)||"";}catch{return "";}}
export default function WorkspaceShell({workspace,userId,restaurantId,children}:{workspace:Workspace;userId:string;restaurantId?:string;children:ReactNode}){
  const pathname=usePathname(),params=useParams(),router=useRouter(),drawer=useRef<HTMLDialogElement>(null);
  const restaurant=workspace.restaurants.find(r=>r.id===restaurantId),root=restaurantId?`/admin/restaurants/${restaurantId}`:"/admin";
  const assignment=workspace.assignments.find(a=>a.restaurant_id===restaurantId&&a.id===params.branchId);
  const owner=!!restaurant,platform=workspace.super_admin&&!restaurantId;
  const branches=workspace.branches.filter(b=>b.restaurant_id===restaurantId),fallback=branches.find(b=>b.is_active)?.id||branches[0]?.id||"";
  const key=`qr-workspace:${userId}:${restaurantId||"platform"}`;
  const stored=useSyncExternalStore(subscribeStorage,()=>storedBranch(key),()=>"");
  const [selection,setSelection]=useState<{key:string;value:string}|null>(null);
  const remembered=selection?.key===key?selection.value:stored;
  const branchId=typeof params.branchId==="string"&&branches.some(b=>b.id===params.branchId)?params.branchId:branches.some(b=>b.id===remembered)?remembered:fallback;
  useEffect(()=>{drawer.current?.close();},[pathname]);
  const branch=branches.find(b=>b.id===branchId),branchRoot=branchId?`${root}/branches/${branchId}`:`${root}/branches`;
  function chooseBranch(id:string){
    if(!branches.some(b=>b.id===id))return;
    setSelection({key,value:id});try{localStorage.setItem(key,id);}catch{}
    const branchMatch=pathname.match(/\/branches\/[a-f0-9-]+(\/.*)?$/i);
    if(branchMatch)router.push(`${root}/branches/${id}${branchMatch[1]||""}`);
    else if(pathname.includes("/live-tables"))router.push(`${root}/live-tables?branch=${id}`);
    else if(["reports","accounts","activity"].some(part=>pathname===`${root}/${part}`))router.push(`${pathname}?branch=${id}`);
  }
  const links=platform?[{href:"/admin",label:"Restoranlar",icon:Building2},{href:"/admin/restaurants/new",label:"Restoran əlavə et",icon:UtensilsCrossed}]:owner?[
    {href:root,label:"Ümumi baxış",icon:LayoutDashboard},
    {href:`${root}/menu`,label:"Menyu",icon:UtensilsCrossed},
    {href:branchId?`${root}/live-tables?branch=${branchId}`:`${root}/live-tables`,label:"Canlı masalar",icon:Grid2X2},
    {href:`${branchRoot}/orders`,label:"Ofisiant paneli",icon:BellRing},
    {href:`${branchRoot}/kitchen`,label:"Mətbəx paneli",icon:ChefHat},
    {href:branchRoot,label:"Masalar və QR",icon:QrCode},
    {href:`${root}/staff`,label:"Komanda",icon:Users},
    {href:`${root}/reports`,label:"Hesabatlar",icon:ChartNoAxesCombined},
  ].filter(link=>branchId||!["Ofisiant paneli","Mətbəx paneli","Masalar və QR"].includes(link.label)):assignment?[
    {href:assignmentPath(assignment),label:assignment.staff_kind==="KITCHEN"?"Mətbəx paneli":"Ofisiant paneli",icon:assignment.staff_kind==="KITCHEN"?ChefHat:BellRing},
  ]:[{href:"/admin?secim=1",label:"İş yerləri",icon:Building2}];
  const extra=owner?[{href:`${root}/branches`,label:"Filiallar və məkan",icon:MapPin},{href:branchId?`${branchRoot}/menu`:`${root}/menu`,label:"Filial qiymətləri",icon:UtensilsCrossed},{href:`${root}/accounts`,label:"Hesab tarixçəsi",icon:History},{href:`${root}/activity`,label:"Fəaliyyət tarixçəsi",icon:History}]:[];
  const current=(href:string)=>{const path=href.split("?")[0];return pathname===path||(path!==root&&pathname.startsWith(path+"/")&&!path.endsWith(branchId));};
  function navItem(item:(typeof links)[number]){const Icon=item.icon,active=current(item.href);return <PortalLink key={item.href} href={item.href} aria-current={active?"page":undefined} className={`rounded-xl px-3 py-3 text-sm font-medium ${active?"bg-emerald-800 text-white shadow-sm":"text-slate-600 hover:bg-slate-100 hover:text-slate-950"}`}><Icon size={18} className="shrink-0"/><span>{item.label}</span></PortalLink>;}
  const title=restaurant?.name||assignment?.restaurant_name||(platform?"Platforma admini":"QR Restoran"),role=platform?"Platforma admini":owner||workspace.restaurants.length?"Restoran sahibi":assignment?.staff_kind==="KITCHEN"?"Mətbəx":assignment?"Ofisiant":"İşçi";
  const navigation=<div className="flex h-full min-h-0 flex-col p-4"><Link href="/admin" className="mb-6 flex min-h-12 items-center gap-3 px-2"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-400 font-black text-slate-950">QR</span><span><span className="block font-bold text-slate-950">QR Restoran</span><span className="text-xs text-slate-500">{role}</span></span></Link><nav aria-label="Əsas bölmələr" className="min-h-0 flex-1 space-y-1 overflow-y-auto">{links.map(navItem)}{!!extra.length&&<details className="pt-3"><summary className="min-h-11 cursor-pointer px-3 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Digər bölmələr</summary><div className="space-y-1 pt-1">{extra.map(navItem)}</div></details>}</nav><div className="mt-4 space-y-1 border-t border-slate-100 pt-3">{(workspace.super_admin||workspace.restaurants.length+workspace.assignments.length>1)&&<PortalLink href="/admin?secim=1" className="rounded-xl px-3 py-3 text-sm text-slate-600"><Building2 size={18}/>İş yerini dəyiş</PortalLink>}<PortalLink href="/admin/account" className="rounded-xl px-3 py-3 text-sm text-slate-600"><Settings size={18}/>Hesab ayarları</PortalLink><form action={signOutAction}><button className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 py-3 text-left text-sm text-slate-600 hover:bg-slate-100"><LogOut size={18}/>Çıxış</button></form></div></div>;
  return <div className="min-h-screen bg-slate-50 text-slate-900"><a href="#portal-content" className="sr-only z-[100] rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Məzmuna keç</a><aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-slate-200 bg-white lg:block">{navigation}</aside>
    <div className="lg:pl-60"><header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur"><div className="flex min-h-20 flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-8"><div className="flex min-w-0 flex-1 items-center gap-3"><button aria-label="Bölmələri aç" onClick={()=>drawer.current?.showModal()} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-slate-200 lg:hidden"><Menu size={20}/></button><div className="min-w-0"><p className="truncate font-bold">{title}</p><p className="text-xs text-slate-500">{role}{assignment?` · ${assignment.name}`:""}</p></div></div>
      {owner&&branches.length>0&&<label className="flex max-w-full items-center gap-2 text-sm"><span className="sr-only">Aktiv filial</span><MapPin size={16} className="shrink-0 text-emerald-700"/><select aria-label="Aktiv filial" value={branchId} onChange={e=>chooseBranch(e.target.value)} className="min-h-11 max-w-[min(100%,240px)] rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-base sm:max-w-64">{branches.map(b=><option key={b.id} value={b.id}>{b.name}{b.is_active?"":" (deaktiv)"}</option>)}</select></label>}
      {!owner&&workspace.assignments.length>1&&<select aria-label="İş yerini seç" value={assignment?.id||""} onChange={e=>{const target=workspace.assignments.find(a=>a.id===e.target.value);if(target)router.push(assignmentPath(target));}} className="min-h-11 max-w-64 rounded-xl border border-slate-200 bg-white px-3 text-base"><option value="" disabled>İş yerini seç</option>{workspace.assignments.map(a=><option key={a.id} value={a.id}>{a.restaurant_name} · {a.name}</option>)}</select>}
    </div>{owner&&branch&&<div className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2 text-xs text-slate-500 sm:px-8"><span className="shrink-0">{branch.name}</span><span className="shrink-0">·</span><span className={`shrink-0 ${branch.is_active&&branch.accepting_orders?"text-emerald-700":"text-amber-700"}`}>{branch.is_active&&branch.accepting_orders?"Sifariş qəbulu açıqdır":"Sifariş qəbulu bağlıdır"}</span></div>}</header><div id="portal-content" tabIndex={-1}>{children}</div></div>
    <dialog ref={drawer} aria-label="Bölmələr" className="fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-[min(88vw,300px)] max-w-none border-0 bg-white p-0 backdrop:bg-slate-950/40" onClick={e=>{if(e.target===e.currentTarget)drawer.current?.close();}}><button aria-label="Bölmələri bağla" onClick={()=>drawer.current?.close()} className="absolute right-3 top-4 z-10 grid h-10 w-10 place-items-center rounded-xl bg-slate-100"><X size={18}/></button>{navigation}</dialog>
  </div>;
}
