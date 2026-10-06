"use client";
import Link from "next/link";
import {useState} from "react";
import {formatOwnerTime} from "@/lib/owner-dashboard";
import {elapsedText} from "@/lib/live-tables";
import {orderLabels} from "@/lib/qr-orders";
import {kitchenLanes,kitchenActionLabels,type KitchenBoard,type KitchenLane} from "@/lib/kitchen";
import {useKitchen} from "@/lib/use-kitchen";
import KitchenSound from "./kitchen-sound";

export default function KitchenPanel({restaurantId,branchId,initialBoard,warning}:{restaurantId:string;branchId:string;initialBoard:KitchenBoard;warning:string}){
  const live=useKitchen(restaurantId,branchId,initialBoard),board=live.board;
  const [lane,setLane]=useState<KitchenLane>(()=>{
    if(initialBoard.filters.search)for(const key of Object.keys(kitchenLanes) as KitchenLane[])if(BigInt(initialBoard.counts[key])>BigInt(0))return key;
    return "NEW";
  });
  const root=`/admin/restaurants/${restaurantId}/branches/${branchId}`,button="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-800 disabled:opacity-40";
  if(!board)return <div className="space-y-3 rounded-xl bg-red-50 p-5"><p role="alert" className="text-sm leading-6 text-red-800">{live.error}</p><Link prefetch={false} href="/admin" className={button}>Cari filialını yoxla</Link></div>;
  const delayed=live.now-Date.parse(board.generated_at)>15000;
  return <div className="space-y-5" aria-busy={Boolean(live.pending)}>
    <header className="space-y-2"><h1 className="text-2xl font-bold">Mətbəx ekranı</h1><p className="break-words text-sm font-semibold text-emerald-900">{board.restaurant_name} · {board.branch_name}</p><p className="text-sm leading-6 text-slate-500">Hər sifarişdə masa adı və sifariş nömrəsi var. Qəbul et → hazırlamağa başla → hazır et.</p></header>
    <KitchenSound latest={board.latest_new_number} allowed={board.sound_enabled}/>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"><div className="space-y-1 text-xs leading-5 text-slate-500"><p>Son yenilənmə: {formatOwnerTime(board.generated_at)}</p><p>{delayed?"Yenilənmə gecikir. Son alınmış vəziyyət göstərilir.":"4 saniyədən bir yenilənir."}</p></div><button type="button" disabled={Boolean(live.pending)} onClick={()=>void live.refresh()} className={button}>{live.pending==="READ"?"Yenilənir...":"Paneli yenilə"}</button></div>
    {(live.error||warning)&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{live.error||warning}</p>}
    {live.notice&&<p role="status" className="break-words rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-800">{live.notice}</p>}
    <form action={`${root}/kitchen`} aria-label="Mətbəx axtarışı" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"><label className="min-w-0 flex-1 space-y-2 text-sm font-medium"><span>Masa və ya sifariş axtar</span><input aria-label="Masa və ya sifariş axtar" name="q" maxLength={80} defaultValue={board.filters.search} placeholder="Masa adı, nömrəsi və ya #sifariş" className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3 py-3 text-base"/></label><button disabled={Boolean(live.pending)} className={button}>Axtar</button><Link prefetch={false} href={`${root}/kitchen`} className="inline-flex min-h-12 items-center px-2 text-sm font-semibold text-emerald-800">Təmizlə</Link></form>
    {board.filters.search&&<p className="break-words text-sm text-slate-500">Axtarış: “{board.filters.search}”. Saylar bu seçimə uyğundur.</p>}
    <nav aria-label="Mətbəx mərhələləri" className="grid grid-cols-3 gap-2 lg:hidden">{Object.entries(kitchenLanes).map(([key,label])=><button type="button" key={key} onClick={()=>setLane(key as KitchenLane)} aria-pressed={lane===key} className={`min-h-14 min-w-0 space-y-2 rounded-xl p-3 text-center text-xs font-semibold ${lane===key?"bg-emerald-800 text-white":"border border-slate-200 bg-white text-slate-700"}`}><span className="block break-words">{label}</span><span className="block tabular-nums">{board.counts[key as KitchenLane]}</span></button>)}</nav>
    <div className="grid items-start gap-4 lg:grid-cols-3">{Object.entries(kitchenLanes).map(([key,title])=>{
      const stage=key as KitchenLane,orders=board.orders.filter(order=>order.lane===stage),hasMore=BigInt(board.counts[stage])>BigInt(orders.length);
      return <section key={stage} aria-label={title} className={`${lane===stage?"block":"hidden"} min-w-0 space-y-3 lg:block`}>
        <header className={`flex items-center justify-between gap-2 rounded-xl p-4 ${stage==="READY"?"bg-amber-100 text-amber-900":stage==="WORKING"?"bg-blue-100 text-blue-900":"bg-emerald-100 text-emerald-900"}`}><h2 className="text-base font-bold">{title}</h2><span className="break-all text-sm font-semibold tabular-nums">{board.counts[stage]}</span></header>
        <p className="text-xs text-slate-500">{orders.length} / {board.counts[stage]} sifariş · Əvvəl gələn yuxarıdadır</p>
        {orders.length?orders.map(order=><article key={order.id} aria-label={`${order.table_name} · Sifariş #${order.number}`} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4">
          <header className="space-y-2"><h3 className="break-words text-xl font-bold text-emerald-950">{order.table_name}</h3><div className="flex flex-wrap items-center justify-between gap-2"><p className="break-all text-sm font-bold">Sifariş #{order.number}</p><span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium">{orderLabels[order.status]}</span></div></header>
          <p className="text-xs leading-5 text-slate-500">{formatOwnerTime(order.created_at)} · {elapsedText(order.created_at,live.now)}</p>
          <ul className="space-y-3 text-base">{order.items.map((item,i)=><li key={i} className="break-words"><strong className="text-lg">{item.quantity} ×</strong> {item.name}</li>)}</ul>
          {order.note&&<p className="whitespace-pre-wrap break-words rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Qeyd: {order.note}</p>}
          {order.status!=="READY"?<button type="button" disabled={Boolean(live.pending)||Boolean(live.error)} onClick={()=>void live.action(order)} className="min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 text-sm font-bold text-white disabled:opacity-40">{live.pending===order.id?"Yenilənir...":kitchenActionLabels[order.status]}</button>:<p className="text-xs leading-5 text-slate-500">Ofisiant servis etdikdə siyahıdan çıxacaq.</p>}
        </article>):<p className="rounded-xl border border-dashed border-slate-300 bg-white p-5 text-sm leading-6 text-slate-500">{board.filters.search?"Axtarışa uyğun sifariş yoxdur.":"Bu mərhələdə sifariş yoxdur."}</p>}
        {hasMore&&(board.filters.limit<150?<button type="button" disabled={Boolean(live.pending)} onClick={()=>void live.refresh(board.filters.limit+30)} className={`${button} w-full`}>Daha çox sifariş göstər</button>:<p className="rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-600">İlk 150 sifariş göstərilir. Qalanları tapmaq üçün masa və ya #sifariş nömrəsi ilə axtar.</p>)}
      </section>;
    })}</div>
    <Link prefetch={false} href={`${root}/orders`} className={button}>Servis və hesab üçün işçi panelini aç →</Link>
  </div>;
}
