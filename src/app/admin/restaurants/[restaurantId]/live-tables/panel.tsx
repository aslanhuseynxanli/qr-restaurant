"use client";
import Link from "next/link";
import {formatOwnerTime,ownerMoney} from "@/lib/owner-dashboard";
import {elapsedText,hasCount,liveQuery,tableViews,type LiveBoard,type LiveTable} from "@/lib/live-tables";
import {paymentLabels} from "@/lib/qr-orders";
import {useLiveTables} from "@/lib/use-live-tables";
import {LiveControls,LiveDenied,liveButton} from "./live-controls";
const field="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base disabled:opacity-50";

function TableCard({table,root,now,backQuery}:{table:LiveTable;root:string;now:number;backQuery:string}){
  const bill=table.session_status==="BILL_REQUESTED",waiter=table.services.some(c=>c.kind==="WAITER");
  return <article aria-label={`${table.branch_name} · ${table.name}`} className={`min-w-0 space-y-4 rounded-2xl border bg-white p-4 sm:p-5 ${bill?"border-amber-300":waiter||hasCount(table.orders.new)?"border-emerald-300":"border-slate-200"}`}>
    <header className="space-y-2"><p className="break-words text-xs text-slate-500">{table.branch_name}</p><div className="flex flex-wrap items-start justify-between gap-2"><h2 className="min-w-0 break-words text-lg font-bold">{table.name}</h2><span className={`rounded-full px-3 py-1.5 text-xs font-semibold ${bill?"bg-amber-100 text-amber-900":table.session_id?"bg-emerald-50 text-emerald-900":"bg-slate-100 text-slate-600"}`}>{bill?"Hesab istənilib":table.session_id?"Açıq hesab":"Açıq hesab yoxdur"}</span></div>
      {!table.is_active&&<p className="text-xs text-amber-800">Masa deaktivdir.</p>}{(!table.branch_active||!table.accepting_orders)&&<p className="text-xs text-amber-800">{!table.branch_active?"Filial deaktivdir.":"Yeni sifariş qəbulu bağlıdır."}</p>}
    </header>
    {table.session_id?<>
      <p className="text-xs leading-5 text-slate-500">Açıldı: {formatOwnerTime(table.opened_at!)} · {elapsedText(table.opened_at,now)}</p>
      <div className="flex flex-wrap gap-2 text-xs font-semibold">{hasCount(table.orders.new)&&<span className="break-all rounded-lg bg-emerald-50 px-2.5 py-2 text-emerald-900">Yeni: {table.orders.new}</span>}{hasCount(table.orders.working)&&<span className="break-all rounded-lg bg-blue-50 px-2.5 py-2 text-blue-900">Hazırlanan: {table.orders.working}</span>}{hasCount(table.orders.ready)&&<span className="break-all rounded-lg bg-amber-50 px-2.5 py-2 text-amber-900">Hazır: {table.orders.ready}</span>}{hasCount(table.orders.served)&&<span className="break-all rounded-lg bg-slate-100 px-2.5 py-2 text-slate-700">Servis edildi: {table.orders.served}</span>}</div>
      {!hasCount(table.orders.all)&&<p className="text-sm leading-6 text-slate-500">QR açılıb, hələ sifariş yoxdur.</p>}
      {table.oldest_order_at&&<p className="text-xs leading-5 text-slate-500">İlk gözləyən sifariş: {elapsedText(table.oldest_order_at,now)}</p>}
      {table.services.length>0&&<div className="space-y-2">{table.services.map(c=><div key={c.kind} className={`rounded-xl p-3 text-xs leading-5 ${c.kind==="BILL"?"bg-amber-50 text-amber-900":"bg-emerald-50 text-emerald-900"}`}><p className="font-semibold">{c.kind==="BILL"?"Hesab istəyi":"Ofisiant çağırışı"} · {elapsedText(c.created_at,now)}</p><p>{c.status==="SEEN"?"İşçi görüb":"Yeni çağırış"}{c.kind==="BILL"?` · ${c.method?paymentLabels[c.method]:"Ödəniş üsulu seçilməyib"}`:""}</p></div>)}</div>}
      <div className="space-y-1 border-t border-slate-100 pt-3"><p className="text-xs text-slate-500">Masa üzrə hesab</p>{table.amounts.length?table.amounts.map(a=><p key={a.currency} className="break-words text-lg font-bold tabular-nums text-emerald-900">{ownerMoney(a.total,a.currency)}</p>):<p className="text-sm text-slate-500">Ödəniləcək sifariş yoxdur.</p>}</div>
    </>:<p className="text-sm leading-6 text-slate-500">Bu masa üçün açıq QR hesabı yoxdur.</p>}
    <Link prefetch={false} href={`${root}/${table.id}?back=${encodeURIComponent(backQuery)}`} className={`${liveButton} w-full`}>Masaya bax →</Link>
  </article>;
}
export default function LiveTablesPanel({restaurantId,initialBoard,warning}:{restaurantId:string;initialBoard:LiveBoard;warning:string}){
  const root=`/admin/restaurants/${restaurantId}/live-tables`,api=`/api/owner/restaurants/${restaurantId}/live-tables`;
  const live=useLiveTables(initialBoard,`${api}?${liveQuery(initialBoard.filters)}`),board=live.data;
  if(!board)return <LiveDenied error={live.error}/>;
  const branch=board.filters.branch_id?board.branches.find(b=>b.id===board.filters.branch_id)?.name:"Bütün filiallar";
  return <div className="space-y-5" aria-busy={live.pending}>
    <LiveControls generatedAt={board.generated_at} now={live.now} pending={live.pending} automatic={live.automatic} onAutomatic={live.setAutomatic} onRefresh={()=>void live.refresh()}/>
    {(live.error||warning)&&<p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">{live.error||warning}</p>}
    <form action={root} aria-label="Canlı masa filtrləri" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><input type="hidden" name="view" value={board.filters.view}/>
      <div className="grid gap-4 sm:grid-cols-2"><label className="min-w-0 space-y-2 text-sm font-medium"><span>Filial</span><select name="branch" aria-label="Filial" defaultValue={board.filters.branch_id||""} className={field}><option value="">Bütün filiallar</option>{board.branches.map(b=><option key={b.id} value={b.id}>{b.name}{!b.is_active?" (deaktiv)":""}</option>)}</select></label><label className="min-w-0 space-y-2 text-sm font-medium"><span>Masa axtar</span><input name="q" aria-label="Masa axtar" maxLength={80} defaultValue={board.filters.search} placeholder="Masa adı və ya dəqiq nömrəsi" className={field}/></label></div>
      <div className="flex flex-wrap gap-2"><button disabled={live.pending} className="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Filtrləri tətbiq et</button><Link prefetch={false} href={root} className="inline-flex min-h-12 items-center px-3 text-sm font-semibold text-emerald-800">Filtrləri təmizlə</Link></div>
    </form>
    <div className="space-y-3"><p className="break-words text-sm font-semibold">{branch}{board.filters.search?` · “${board.filters.search}”`:""}</p><nav aria-label="Masa vəziyyəti" className="grid grid-cols-2 gap-2 sm:grid-cols-4">{Object.entries(tableViews).map(([view,label])=><Link prefetch={false} key={view} href={`${root}?${liveQuery({...board.filters,view:view as keyof typeof tableViews,limit:30})}`} aria-current={board.filters.view===view?"page":undefined} className={`flex min-h-14 min-w-0 items-center justify-between gap-2 rounded-xl border px-3 py-3 text-sm font-semibold ${board.filters.view===view?"border-emerald-800 bg-emerald-800 text-white":"border-slate-200 bg-white text-slate-700"}`}><span className="min-w-0 break-words">{label}</span><span className={`shrink-0 rounded-lg px-2 py-1 text-xs tabular-nums ${board.filters.view===view?"bg-white/15":"bg-slate-100"}`}>{board.summary[view as keyof typeof tableViews]}</span></Link>)}</nav><p className="text-xs leading-5 text-slate-500">Saylar seçilmiş filial və axtarış üzrə masaların sayıdır. Eyni masada həm yeni sifariş, həm də çağırış ola bilər.</p></div>
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">{tableViews[board.filters.view]}</h2><p className="text-xs text-slate-500">{board.tables.length} / {board.matched_count} masa göstərilir</p></div>
    {!board.tables.length?<p className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-6 text-slate-600">Bu seçimə uyğun masa yoxdur. Filial, axtarış və ya vəziyyət seçimini dəyiş.</p>:<div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">{board.tables.map(table=><TableCard key={table.id} table={table} root={root} now={live.now} backQuery={liveQuery(board.filters)}/>)}</div>}
    {board.has_more&&(board.filters.limit<300?<button type="button" disabled={live.pending} onClick={()=>void live.refresh(`${api}?${liveQuery({...board.filters,limit:board.filters.limit+30})}`)} className={`${liveButton} w-full`}>Daha çox masa göstər</button>:<p className="rounded-xl bg-slate-100 p-4 text-sm leading-6 text-slate-600">İlk 300 masa göstərilir. Qalan masaları tapmaq üçün filial və ya masa axtarışını seç.</p>)}
  </div>;
}
