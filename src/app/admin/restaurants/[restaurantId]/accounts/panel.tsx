"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {accountMethods,accountLabel,accountTitle,validAccountFilters,type AccountHistory} from "@/lib/account-history";
import {formatOwnerDate,formatOwnerTime,ownerMoney} from "@/lib/owner-dashboard";
import {readAccountHistoryAction} from "./actions";
const field="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base disabled:opacity-50";
const button="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium disabled:opacity-50";
export default function HistoryPanel({restaurantId,initialPage,warning}:{restaurantId:string;initialPage:AccountHistory;warning:string}) {
  const [page,setPage]=useState<AccountHistory|null>(initialPage),[pending,setPending]=useState(false),[error,setError]=useState(warning);
  const busy=useRef(false),alive=useRef(true);const root=`/admin/restaurants/${restaurantId}/accounts`;
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function read(append:boolean){
    if(!page||busy.current||append&&!page.next_cursor)return;
    busy.current=true;setPending(true);setError("");
    try{
      const result=await readAccountHistoryAction(restaurantId,page.filters,append?page.next_cursor:null);
      if(!alive.current)return;
      if(result.data)setPage(old=>({...result.data,accounts:append&&old?[...old.accounts,...result.data.accounts.filter(a=>!old.accounts.some(o=>o.id===a.id))]:result.data.accounts}));
      else{setError(result.error);if(result.denied)setPage(null);}
    }catch{if(alive.current)setError("Hesab tarixçəsi yüklənmədi. Yenidən cəhd et.");}
    finally{busy.current=false;if(alive.current)setPending(false);}
  }
  if(!page)return <div role="alert" className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p className="text-sm text-red-800">{error}</p><Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">Hesabını yoxla</Link></div>;
  return <div className="space-y-5" aria-busy={pending}>
    <form action={root} aria-label="Hesab tarixçəsi filtrləri" onSubmit={event=>{
      const form=new FormData(event.currentTarget);
      if(!validAccountFilters({branch_id:form.get("branch")||null,method:form.get("method")||null,from:form.get("from"),to:form.get("to"),search:form.get("q")||""})){event.preventDefault();setError("Filtrləri düzgün seç. Ən çox 366 gün göstərilə bilər.");}
    }} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><label className="min-w-0 space-y-2 text-sm font-medium"><span>Filial</span><select name="branch" aria-label="Filial" defaultValue={page.filters.branch_id||""} disabled={pending} className={field}><option value="">Bütün filiallar</option>{page.branches.map(b=><option key={b.id} value={b.id}>{b.name}{!b.is_active?" (deaktiv)":""}</option>)}</select></label>
        <label className="min-w-0 space-y-2 text-sm font-medium"><span>Ödəniş</span><select name="method" aria-label="Ödəniş" defaultValue={page.filters.method||""} disabled={pending} className={field}><option value="">Bütün hesablar</option>{Object.entries(accountMethods).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
        <label className="min-w-0 space-y-2 text-sm font-medium"><span>Başlanğıc tarix</span><input name="from" aria-label="Başlanğıc tarix" type="date" required defaultValue={page.filters.from} disabled={pending} className={field}/></label>
        <label className="min-w-0 space-y-2 text-sm font-medium"><span>Son tarix</span><input name="to" aria-label="Son tarix" type="date" required defaultValue={page.filters.to} disabled={pending} className={field}/></label>
      </div><div className="flex flex-wrap items-end gap-3"><label className="w-full min-w-0 space-y-2 text-sm font-medium sm:max-w-sm"><span>Masa və ya hesab nömrəsi</span><input name="q" aria-label="Masa və ya hesab nömrəsi" defaultValue={page.filters.search} placeholder="Masa adı və ya nömrə" maxLength={80} disabled={pending} className={field}/></label><button disabled={pending} className="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Filtrləri tətbiq et</button><Link href={root} className="inline-flex min-h-12 items-center px-3 text-sm font-medium text-emerald-800">Filtrləri təmizlə</Link></div>
    </form>
    <section aria-label="Seçilmiş hesabların yekunu" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><p className="text-sm leading-6 text-slate-600">{formatOwnerDate(page.filters.from)} — {formatOwnerDate(page.filters.to)} · Bakı vaxtı<br/>{page.summary.count} hesab: {page.summary.recorded_count} ödəniş qeydli, {page.summary.legacy_count} ödəniş bölgüsü qeydsiz, {page.summary.empty_count} sifarişsiz</p>
      {page.summary.amounts.map(a=><div key={a.currency} className="space-y-3 border-t border-slate-100 pt-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-3">{[["Qeyd edilmiş ödəniş",a.recorded],["Nağd",a.cash],["Kart",a.card]].map(([label,total])=><div key={label} className="min-w-0 rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">{label}</p><p className="mt-2 break-words text-lg font-bold text-emerald-900">{ownerMoney(total,a.currency)}</p></div>)}</div>{Number(a.legacy)>0&&<p className="text-xs leading-5 text-slate-500">Ödəniş bölgüsü qeydsiz əvvəlki hesabların məbləği: {ownerMoney(a.legacy,a.currency)}. Bu məbləğ yuxarıdakı kart və nağd yekunlarına daxil deyil.</p>}</div>)}
    </section>
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{page.accounts.length} hesab göstərilir</p><button type="button" disabled={pending} onClick={()=>void read(false)} className={button}>{pending?"Yüklənir...":"Tarixçəni yenilə"}</button></div>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
    {page.accounts.length?<div className="grid items-start gap-3 lg:grid-cols-2">{page.accounts.map(a=><article key={a.id} aria-label={accountTitle(a)} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><header className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h2 className="break-words font-semibold">{a.table_name}{a.payment?` · Hesab #${a.payment.number}`:""}</h2><p className="mt-1 break-words text-xs leading-5 text-slate-500">{a.branch_name} · {formatOwnerTime(a.closed_at)}</p></div><span className={`rounded-lg px-2 py-1 text-xs ${a.kind==="PAID"?"bg-emerald-50 text-emerald-800":"bg-slate-100 text-slate-600"}`}>{accountLabel(a)}</span></header>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-slate-500">{a.order_count} sifariş · {a.item_count} servis edilmiş məhsul</p><p className="break-words text-lg font-bold">{ownerMoney(a.total,a.currency)}</p></div>
      {a.payment&&<p className="break-words text-sm leading-6 text-slate-600">Nağd: {ownerMoney(a.payment.cash,a.currency)} · Kart: {ownerMoney(a.payment.card,a.currency)}<br/>Bağlayan: {a.payment.actor_name}</p>}
      <Link href={`${root}/${a.id}`} className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">Hesabın detallarına bax →</Link>
    </article>)}</div>:<p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Bu seçimə uyğun bağlanmış hesab yoxdur.</p>}
    {page.next_cursor&&<button type="button" disabled={pending} onClick={()=>void read(true)} className={`${button} w-full`}>{pending?"Yüklənir...":"Daha çox göstər"}</button>}
  </div>;
}
