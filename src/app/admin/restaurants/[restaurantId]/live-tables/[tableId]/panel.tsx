"use client";
import Link from "next/link";
import {formatOwnerTime,ownerMoney} from "@/lib/owner-dashboard";
import {detailQuery,elapsedText,type LiveDetail,type LiveOrder} from "@/lib/live-tables";
import {orderLabels,paymentLabels} from "@/lib/qr-orders";
import {useLiveTables} from "@/lib/use-live-tables";
import {LiveControls,LiveDenied,liveButton} from "../live-controls";

function OrderCard({order,now}:{order:LiveOrder;now:number}){
  const cancelled=order.status==="CANCELLED",served=order.status==="SERVED";
  return <article aria-label={`Sifariş #${order.number}`} className="min-w-0 space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="break-all text-sm font-bold">Sifariş #{order.number}</h2><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${cancelled?"bg-red-50 text-red-800":served?"bg-slate-100 text-slate-600":order.status==="READY"?"bg-amber-100 text-amber-900":"bg-emerald-50 text-emerald-900"}`}>{orderLabels[order.status]}</span></header>
    <p className="text-xs leading-5 text-slate-500">{formatOwnerTime(order.created_at)}{!cancelled&&!served?` · ${elapsedText(order.created_at,now)}`:""}</p>
    <ul className="space-y-3 text-sm">{order.items.map((item,i)=><li key={i} className="flex items-start justify-between gap-3"><span className="min-w-0 break-words"><strong>{item.quantity} ×</strong> {item.name}</span><span className="min-w-0 break-words text-right tabular-nums">{ownerMoney(item.total,order.currency)}</span></li>)}</ul>
    {order.note&&<p className="whitespace-pre-wrap break-words rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-950">Qeyd: {order.note}</p>}
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-sm font-bold"><span>Sifariş cəmi</span><span className="break-words tabular-nums">{ownerMoney(order.total,order.currency)}</span></div>
    {cancelled&&<p className="text-xs leading-5 text-red-800">Bu sifariş hesabın yekununa daxil deyil.</p>}
  </article>;
}
export default function LiveTablePanel({restaurantId,initialBoard,warning,backQuery}:{restaurantId:string;initialBoard:LiveDetail;warning:string;backQuery:string}){
  const tableId=initialBoard.table.id,root=`/admin/restaurants/${restaurantId}/live-tables/${tableId}`,api=`/api/owner/restaurants/${restaurantId}/live-tables/${tableId}`;
  const live=useLiveTables(initialBoard,`${api}?${detailQuery(initialBoard.filters)}`),board=live.data;
  if(!board)return <LiveDenied error={live.error}/>;
  const session=board.session,changed=(initialBoard.session?.id||null)!==(session?.id||null),closedAccount=changed&&initialBoard.session?.id;
  return <div className="space-y-5" aria-busy={live.pending}>
    <header className="space-y-2"><p className="break-words text-sm text-slate-500">{board.restaurant_name} · {board.table.branch_name}</p><h1 className="break-words text-2xl font-bold">{board.table.name}</h1><p className="text-sm leading-6 text-slate-500">Hər telefondan gələn sifariş bu masanın hesabında göstərilir.</p></header>
    <LiveControls generatedAt={board.generated_at} now={live.now} pending={live.pending} automatic={live.automatic} onAutomatic={live.setAutomatic} onRefresh={()=>void live.refresh()}/>
    {(live.error||warning)&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{live.error||warning}</p>}
    {changed&&<div role="status" className="space-y-2 rounded-xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-950"><p>{session?"Bu masada yeni hesab açılıb. İndi yeni hesabın sifarişləri göstərilir.":"Əvvəlki hesab bağlanıb. Hazırda bu masada açıq hesab yoxdur."}</p>{closedAccount&&<Link prefetch={false} href={`/admin/restaurants/${restaurantId}/accounts/${closedAccount}`} className="inline-flex min-h-11 items-center font-semibold">Əvvəlki hesabın tarixçəsi →</Link>}</div>}
    {(!board.table.is_active||!board.table.branch_active||!board.table.accepting_orders)&&<p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{!board.table.is_active?"Masa deaktivdir. ":""}{!board.table.branch_active?"Filial deaktivdir. ":""}{!board.table.accepting_orders?"Yeni sifariş qəbulu bağlıdır.":""}</p>}
    {session?<>
      <section aria-label="Masa hesabı" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{session.status==="BILL_REQUESTED"?"Hesab istənilib":"Açıq hesab"}</h2><p className="mt-2 text-xs leading-5 text-slate-500">Açıldı: {formatOwnerTime(session.opened_at)} · {elapsedText(session.opened_at,live.now)}</p></div><div className="min-w-0 space-y-1 text-right">{session.amounts.map(a=><p key={a.currency} className="break-words text-xl font-bold tabular-nums text-emerald-900">{ownerMoney(a.total,a.currency)}</p>)}</div></div>
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">{[["Bütün sifarişlər",session.counts.all],["Gözləyən",session.counts.active],["Servis edildi",session.counts.served],["Ləğv edildi",session.counts.cancelled]].map(([title,count])=><div key={title} className="min-w-0 rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">{title}</dt><dd className="mt-2 break-all text-lg font-bold tabular-nums">{count}</dd></div>)}</dl>
        <p className="text-xs leading-5 text-slate-500">Yekuna ləğv edilməmiş sifarişlər daxildir. Ödəniş işçi panelində təsdiqlənir.</p>
      </section>
      {session.services.length>0&&<section aria-label="Masa çağırışları" className="grid gap-3 sm:grid-cols-2">{session.services.map(call=><article key={call.kind} className={`space-y-2 rounded-2xl border p-4 ${call.kind==="BILL"?"border-amber-200 bg-amber-50 text-amber-950":"border-emerald-200 bg-emerald-50 text-emerald-950"}`}><h2 className="text-sm font-bold">{call.kind==="BILL"?"Hesab istəyi":"Ofisiant çağırışı"}</h2><p className="text-xs leading-5">{formatOwnerTime(call.created_at)} · {elapsedText(call.created_at,live.now)} · {call.status==="SEEN"?"İşçi görüb":"Yeni çağırış"}</p>{call.kind==="BILL"&&<p className="text-sm font-semibold">Müştərinin seçimi: {call.method?paymentLabels[call.method]:"Üsul seçilməyib"}</p>}</article>)}</section>}
      <nav aria-label="Masa sifarişləri" className="grid grid-cols-2 gap-2">{([['ACTIVE','Gözləyən sifarişlər'],['ALL','Bütün sifarişlər']] as const).map(([mode,label])=><Link prefetch={false} key={mode} href={`${root}?${detailQuery({mode,limit:30})}${backQuery?`&back=${encodeURIComponent(backQuery)}`:""}`} aria-current={board.filters.mode===mode?"page":undefined} className={`flex min-h-12 items-center justify-center rounded-xl border px-3 py-3 text-center text-sm font-semibold ${board.filters.mode===mode?"border-emerald-800 bg-emerald-800 text-white":"border-slate-200 bg-white text-slate-700"}`}>{label}</Link>)}</nav>
      <p className="text-xs text-slate-500">{board.orders.length} / {board.matched_count} sifariş göstərilir · Əvvəl gələn yuxarıdadır.</p>
      {board.orders.length?<div className="grid items-start gap-4 md:grid-cols-2">{board.orders.map(order=><OrderCard key={order.id} order={order} now={live.now}/>)}</div>:<p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">{session.counts.all==="0"?"Hələ sifariş yoxdur.":board.filters.mode==="ACTIVE"?"Gözləyən sifariş yoxdur. Servis və ləğv edilmiş sifarişləri “Bütün sifarişlər” bölməsində gör.":"Bu hesabda sifariş yoxdur."}</p>}
      {board.has_more&&(board.filters.limit<300?<button type="button" disabled={live.pending} onClick={()=>void live.refresh(`${api}?${detailQuery({...board.filters,limit:board.filters.limit+30})}`)} className={`${liveButton} w-full`}>Daha çox sifariş göstər</button>:<p className="rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-600">İlk 300 sifariş göstərilir. Gözləyən sifarişləri ayrıca seçimdən aç; yekun məbləğ bütün sifarişlər üzrə hesablanır.</p>)}
    </>:<p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm leading-6 text-slate-600">Bu masa üçün açıq QR hesabı yoxdur.</p>}
    <div className="flex flex-wrap gap-2"><Link prefetch={false} href={`/admin/restaurants/${restaurantId}/branches/${board.table.branch_id}/orders`} className={liveButton}>İşçi panelini aç</Link><Link prefetch={false} href={`/admin/restaurants/${restaurantId}/accounts?branch=${board.table.branch_id}`} className={liveButton}>Filialın hesab tarixçəsi</Link></div>
  </div>;
}
