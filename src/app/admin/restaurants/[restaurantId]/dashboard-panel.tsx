"use client";
import Link from "next/link";
import {useCallback,useEffect,useRef,useState} from "react";
import {formatOwnerDate,formatOwnerTime,ownerMoney,type OwnerBranch,type OwnerDashboard} from "@/lib/owner-dashboard";
import {readDashboardAction} from "./dashboard-actions";
import EventCard from "./activity/event-card";

const outlined="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-emerald-400 disabled:opacity-50";
const primary="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-900";
function BranchCard({branch,root}:{branch:OwnerBranch;root:string}) {
  return <article aria-label={branch.name} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-lg font-semibold">{branch.name}</h3>{branch.address&&<p className="mt-1 break-words text-sm text-slate-500">{branch.address}</p>}</div><span className={`rounded-full px-3 py-1.5 text-xs font-medium ${branch.is_active&&branch.accepting_orders?"bg-emerald-50 text-emerald-800":"bg-amber-50 text-amber-800"}`}>{!branch.is_active?"Deaktiv":branch.accepting_orders?"Sifariş qəbulu açıqdır":"Sifariş qəbulu bağlıdır"}</span></div>
    <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Bugünkü sifarişlər</dt><dd className="mt-1 font-semibold">{branch.today_orders}</dd></div><div><dt className="text-slate-500">Açıq masalar</dt><dd className="mt-1 font-semibold">{branch.open_tables}</dd></div><div><dt className="text-slate-500">Yeni sifarişlər</dt><dd className="mt-1 font-semibold">{branch.new_orders}</dd></div><div><dt className="text-slate-500">Çağırışlar</dt><dd className="mt-1 font-semibold">{branch.pending_calls}</dd></div></dl>
    <p className="text-xs text-slate-500">{branch.table_count} aktiv masa · {branch.staff_count} aktiv işçi</p>
    <div className="grid gap-2 sm:grid-cols-2"><Link href={`${root}/branches/${branch.id}/orders`} className={primary}>Sifarişlər və çağırışlar</Link><Link href={`${root}/branches/${branch.id}`} className={outlined}>Masalar və QR</Link></div>
  </article>;
}
export default function DashboardPanel({restaurantId,initialBoard}:{restaurantId:string;initialBoard:OwnerDashboard}) {
  const [board,setBoard]=useState<OwnerDashboard|null>(initialBoard),[branchId,setBranchId]=useState<string|null>(null);
  const [pending,setPending]=useState(false),[error,setError]=useState("");
  const busy=useRef(false),alive=useRef(true),selected=useRef<string|null>(null);
  const root=`/admin/restaurants/${restaurantId}`;
  const refresh=useCallback(async(branch:string|null,manual=false)=>{
    if(busy.current)return;
    busy.current=true;setPending(true);if(manual)setError("");
    try {
      const result=await readDashboardAction(restaurantId,branch);
      if(!alive.current)return;
      if(result.data){setBoard(result.data);setError("");setBranchId(branch);selected.current=branch;}
      else{setError(result.error);if(result.denied)setBoard(null);}
    }catch{if(alive.current)setError("Göstəricilər yenilənmədi. Yenidən cəhd et.");}
    finally{busy.current=false;if(alive.current)setPending(false);}
  },[restaurantId]);
  useEffect(()=>{
    alive.current=true;
    const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh(selected.current);},15000);
    const focus=()=>{if(document.visibilityState==="visible")void refresh(selected.current);};
    document.addEventListener("visibilitychange",focus);
    return()=>{alive.current=false;clearInterval(timer);document.removeEventListener("visibilitychange",focus);};
  },[refresh]);
  if(!board)return <div role="alert" className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p className="text-sm text-red-800">{error}</p><Link href="/admin" className={outlined}>Hesabını yoxla</Link></div>;
  const counts=board.totals,branches=board.branches.filter(b=>branchId===null||b.id===branchId);
  const activityURL=`${root}/activity${branchId?`?branch=${branchId}`:""}`;
  return <div className="space-y-6" aria-busy={pending}>
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-wider text-emerald-700">Sahib paneli</p><h1 className="mt-2 break-words text-2xl font-bold sm:text-3xl">{board.restaurant.name}</h1><p className="mt-2 text-sm text-slate-500">{formatOwnerDate(board.day)} · Bakı vaxtı</p></div><button onClick={()=>void refresh(branchId,true)} disabled={pending} className={outlined}>{pending?"Yenilənir...":"Paneli yenilə"}</button></header>
    {!board.restaurant.can_manage&&<p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Restoran hazırda aktiv deyil. İdarəetmə əməliyyatları məhdudlaşdırılıb.</p>}
    <div className="flex flex-wrap items-end justify-between gap-3"><label className="block w-full space-y-2 text-sm font-medium sm:max-w-sm"><span>Filial üzrə baxış</span><select aria-label="Filial üzrə baxış" value={branchId||""} disabled={pending} onChange={e=>void refresh(e.target.value||null,true)} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base disabled:opacity-50"><option value="">Bütün filiallar</option>{board.branches.map(b=><option key={b.id} value={b.id}>{b.name}{!b.is_active?" (deaktiv)":""}</option>)}</select></label><p className="text-xs text-slate-500">Son yenilənmə: {formatOwnerTime(board.refreshed_at,false)}</p></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error} Son alınmış göstəricilər göstərilir.</p>}
    <section aria-label="Günün göstəriciləri" className={`grid grid-cols-2 gap-3 lg:grid-cols-4 ${pending?"opacity-60":""}`}>
      <article aria-label="Bugünkü sifarişlər" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-medium text-slate-600">Bugünkü sifarişlər</h2><p className="mt-3 break-all text-3xl font-bold tabular-nums">{counts.today_orders}</p><p className="mt-2 text-xs leading-5 text-slate-500">Ləğv edilən: {counts.cancelled_orders}</p></article>
      <article aria-label="Bağlanan hesablar" className="min-w-0 rounded-2xl bg-emerald-800 p-4 text-white sm:p-5"><h2 className="text-sm font-medium text-emerald-100">Bağlanan hesablar</h2><div className="mt-3 space-y-1">{board.closed_amounts.map(a=><p key={a.currency} className="break-words text-xl font-bold tabular-nums sm:text-2xl">{ownerMoney(a.total,a.currency)}</p>)}</div><p className="mt-2 text-xs leading-5 text-emerald-100">{counts.closed_tables} bağlanan masa</p></article>
      <article aria-label="Açıq masalar" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-medium text-slate-600">Açıq masalar</h2><p className="mt-3 break-all text-3xl font-bold tabular-nums">{counts.open_tables}</p><p className="mt-2 text-xs leading-5 text-slate-500">Sifarişi olan masalar</p></article>
      <article aria-label="Gözləyən çağırışlar" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="text-sm font-medium text-slate-600">Gözləyən çağırışlar</h2><p className="mt-3 break-all text-3xl font-bold tabular-nums">{counts.pending_calls}</p><p className="mt-2 text-xs leading-5 text-slate-500">Hesab istəyi: {counts.pending_bills}</p></article>
    </section>
    <p className="text-xs leading-5 text-slate-500">Məbləğ bu gün işçinin bağladığı masalardakı servis edilmiş sifarişlərə əsaslanır. Ləğv edilmiş sifarişlər çıxılır.</p>
    <section aria-label="Sürətli keçidlər" className="flex flex-wrap gap-2"><Link href={`${root}/branches`} className={outlined}>Filialları idarə et</Link><Link href={`${root}/menu`} className={outlined}>Menyunu idarə et</Link>{board.restaurant.can_manage&&<Link href={`${root}/staff`} className={outlined}>İşçiləri idarə et</Link>}<Link href={activityURL} className={outlined}>Fəaliyyət tarixçəsi</Link></section>
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Filialların vəziyyəti</h2><p className="text-sm text-slate-500">{counts.new_orders} yeni · {counts.working_orders} icrada olan sifariş</p></div>
      {!branches.length?<div className="space-y-4 rounded-2xl border border-dashed border-slate-300 bg-white p-6"><p className="text-sm text-slate-600">İlk filialını əlavə et, sonra masaları və menyunu hazırla.</p><Link href={`${root}/branches`} className={primary}>Filial əlavə et</Link></div>:<div className="grid items-start gap-4 lg:grid-cols-2">{branches.map(b=><BranchCard key={b.id} branch={b} root={root}/>)}</div>}
    </section>
    <section className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Son fəaliyyətlər</h2><Link href={activityURL} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">Bütün tarixçəyə bax →</Link></div>
      {board.recent_activity.length?<div className="grid items-start gap-3 lg:grid-cols-2">{board.recent_activity.map(event=><EventCard key={event.id} event={event}/>)}</div>:<p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Hələ fəaliyyət qeydə alınmayıb.</p>}
    </section>
  </div>;
}
