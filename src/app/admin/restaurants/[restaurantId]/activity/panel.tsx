"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {activityCategories,formatOwnerDate,validFilters,type OwnerActivity} from "@/lib/owner-dashboard";
import {readActivityAction} from "../dashboard-actions";
import EventCard from "./event-card";
const input="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base disabled:opacity-50";
const button="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium disabled:opacity-50";
export default function ActivityPanel({restaurantId,initialPage,warning}:{restaurantId:string;initialPage:OwnerActivity;warning:string}) {
  const [page,setPage]=useState<OwnerActivity|null>(initialPage),[pending,setPending]=useState(false),[error,setError]=useState(warning);
  const busy=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function readMore(append:boolean){
    if(!page||busy.current||append&&!page.next_cursor)return;
    busy.current=true;setPending(true);setError("");
    try{
      const result=await readActivityAction(restaurantId,page.filters,append?page.next_cursor:null);
      if(!alive.current)return;
      if(result.data){const data=result.data;setPage(old=>({...data,events:append&&old?[...old.events,...data.events.filter(e=>!old.events.some(o=>o.id===e.id))]:data.events}));}
      else{setError(result.error);if(result.denied)setPage(null);}
    }catch{if(alive.current)setError("Tarixçə yüklənmədi. Yenidən cəhd et.");}
    finally{busy.current=false;if(alive.current)setPending(false);}
  }
  if(!page)return <div role="alert" className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p className="text-sm text-red-800">{error}</p><Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">Hesabını yoxla</Link></div>;
  return <div className="space-y-5" aria-busy={pending}>
    <form action={`/admin/restaurants/${restaurantId}/activity`} aria-label="Tarixçə filtrləri" onSubmit={event=>{
      const values=new FormData(event.currentTarget);
      if(!validFilters({branch_id:values.get("branch")||null,category:values.get("category")||null,from:values.get("from"),to:values.get("to")})){event.preventDefault();setError("Tarix aralığını düzgün seç. Ən çox 366 gün göstərilə bilər.");}
    }} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="block min-w-0 space-y-2 text-sm font-medium"><span>Filial</span><select aria-label="Filial" name="branch" defaultValue={page.filters.branch_id||""} disabled={pending} className={input}><option value="">Bütün filiallar</option>{page.branches.map(b=><option key={b.id} value={b.id}>{b.name}{!b.is_active?" (deaktiv)":""}</option>)}</select></label>
        <label className="block min-w-0 space-y-2 text-sm font-medium"><span>Əməliyyat növü</span><select aria-label="Əməliyyat növü" name="category" defaultValue={page.filters.category||""} disabled={pending} className={input}><option value="">Bütün əməliyyatlar</option>{Object.entries(activityCategories).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="block min-w-0 space-y-2 text-sm font-medium"><span>Başlanğıc tarix</span><input aria-label="Başlanğıc tarix" type="date" name="from" required defaultValue={page.filters.from} disabled={pending} className={input}/></label>
        <label className="block min-w-0 space-y-2 text-sm font-medium"><span>Son tarix</span><input aria-label="Son tarix" type="date" name="to" required defaultValue={page.filters.to} disabled={pending} className={input}/></label>
      </div><div className="flex flex-wrap gap-2"><button disabled={pending} className="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Filtrləri tətbiq et</button><Link href={`/admin/restaurants/${restaurantId}/activity`} className="inline-flex min-h-12 items-center px-3 text-sm font-medium text-emerald-800">Filtrləri təmizlə</Link></div>
    </form>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm leading-6 text-slate-500">{formatOwnerDate(page.filters.from)} — {formatOwnerDate(page.filters.to)} · {page.events.length} qeyd göstərilir</p><button type="button" disabled={pending} onClick={()=>void readMore(false)} className={button}>{pending?"Yüklənir...":"Tarixçəni yenilə"}</button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
    {page.events.length?<div className="grid items-start gap-3 lg:grid-cols-2">{page.events.map(event=><EventCard key={event.id} event={event}/>)}</div>:<p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Bu seçimə uyğun fəaliyyət tapılmadı.</p>}
    {page.next_cursor&&<button type="button" disabled={pending} onClick={()=>void readMore(true)} className={`${button} w-full`}>{pending?"Yüklənir...":"Daha çox göstər"}</button>}
  </div>;
}
