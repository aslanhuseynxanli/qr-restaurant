"use client";
import Link from "next/link";
import {useEffect,useRef,useState} from "react";
import {accountLabel,accountTitle,type AccountDetail} from "@/lib/account-history";
import {formatOwnerTime,ownerMoney} from "@/lib/owner-dashboard";
import {orderLabels} from "@/lib/qr-orders";
import {readAccountDetailAction} from "../actions";
export default function AccountPanel({restaurantId,initialDetail}:{restaurantId:string;initialDetail:AccountDetail}) {
  const [detail,setDetail]=useState<AccountDetail|null>(initialDetail),[pending,setPending]=useState(false),[error,setError]=useState("");
  const busy=useRef(false),alive=useRef(true);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function refresh(){
    if(!detail||busy.current)return;busy.current=true;setPending(true);setError("");
    try{const result=await readAccountDetailAction(restaurantId,detail.account.id);if(!alive.current)return;
      if(result.data)setDetail(result.data);else{setError(result.error);if(result.denied)setDetail(null);}
    }catch{if(alive.current)setError("Hesab detalları yüklənmədi. Yenidən cəhd et.");}
    finally{busy.current=false;if(alive.current)setPending(false);}
  }
  if(!detail)return <div role="alert" className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p className="text-sm text-red-800">{error}</p><Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-800">Hesabını yoxla</Link></div>;
  const a=detail.account;
  return <div className="space-y-5" aria-busy={pending}>
    <header className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h1 className="break-words text-2xl font-bold">{accountTitle(a)}</h1><p className="mt-2 break-words text-sm leading-6 text-slate-500">{detail.restaurant_name} · {a.branch_name} · {a.table_name}</p></div><button type="button" onClick={()=>void refresh()} disabled={pending} className="min-h-12 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium disabled:opacity-50">{pending?"Yüklənir...":"Hesabı yenilə"}</button></header>
    {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <section aria-label="Hesabın yekunu" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm text-slate-600">{accountLabel(a)}</p><p className="mt-2 break-words text-2xl font-bold text-emerald-900">{ownerMoney(a.total,a.currency)}</p></div><p className="text-xs leading-6 text-slate-500">Açıldı: {formatOwnerTime(a.opened_at)}<br/>Bağlandı: {formatOwnerTime(a.closed_at)}</p></div>
      {a.payment?<div className="space-y-3 border-t border-slate-100 pt-4"><div className="grid grid-cols-2 gap-3"><div className="min-w-0 rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Nağd</p><p className="mt-2 break-words font-semibold">{ownerMoney(a.payment.cash,a.currency)}</p></div><div className="min-w-0 rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-800">Kart</p><p className="mt-2 break-words font-semibold">{ownerMoney(a.payment.card,a.currency)}</p></div></div><p className="break-words text-sm leading-6 text-slate-600">Bağlayan: {a.payment.actor_name} · {a.payment.actor_role}<br/>Ödəniş qeydi: {formatOwnerTime(a.payment.paid_at)}</p></div>:<p className="rounded-xl bg-slate-50 p-3 text-sm leading-6 text-slate-600">{a.kind==="LEGACY"?"Bu hesab əvvəlki versiyada bağlanıb. Faktiki ödəniş üsulu və kart/nağd bölgüsü qeyd edilməyib.":"Bu masa sifarişsiz və ya bütün sifarişləri ləğv edilərək bağlanıb. Ödəniş qeydi yoxdur."}</p>}
      <p className="text-xs leading-5 text-slate-500">Yekuna servis edilmiş sifarişlər daxildir. Ləğv edilmiş sifarişlər hesabdan çıxılıb.</p>
    </section>
    <section className="space-y-3"><h2 className="text-lg font-semibold">Sifarişlər ({detail.orders.length})</h2>{detail.orders.length?detail.orders.map(o=><article key={o.id} aria-label={`Sifariş #${o.number}`} className={`min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-5 ${o.status==="CANCELLED"?"border-red-100":"border-slate-200"}`}><header className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">Sifariş #{o.number}</h3><span className={`rounded-lg px-2 py-1 text-xs ${o.status==="CANCELLED"?"bg-red-50 text-red-800":"bg-emerald-50 text-emerald-800"}`}>{orderLabels[o.status]}</span></header><p className="text-xs text-slate-500">{formatOwnerTime(o.created_at)}</p>
      <div className="space-y-3">{o.items.map((i,index)=><div key={index} className="flex items-start justify-between gap-3 text-sm"><div className="min-w-0"><p className="break-words"><strong>{i.quantity} ×</strong> {i.name}</p><p className="mt-1 text-xs text-slate-500">Vahid qiymət: {ownerMoney(i.price,o.currency)}</p></div><p className="shrink-0 font-medium">{ownerMoney(i.total,o.currency)}</p></div>)}</div>
      {o.note&&<p className="break-words rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Qeyd: {o.note}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm font-semibold"><span>Sifarişin məbləği</span><span>{ownerMoney(o.total,o.currency)}</span></div>{o.status==="CANCELLED"&&<p className="text-xs text-red-800">Ləğv edilib · hesabın yekununa daxil deyil.</p>}
      {!!o.events.length&&<details className="rounded-xl bg-slate-50 p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Status tarixçəsi</summary><ol className="mt-3 space-y-2 text-xs leading-5 text-slate-600">{o.events.map((event,index)=><li key={index} className="break-words">{formatOwnerTime(event.at)} · {orderLabels[event.status]} · {event.actor_name}</li>)}</ol></details>}
    </article>):<p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Bu masadan sifariş verilməyib.</p>}</section>
  </div>;
}
