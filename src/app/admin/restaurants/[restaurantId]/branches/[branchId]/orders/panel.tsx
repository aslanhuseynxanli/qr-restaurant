"use client";

import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { Bell,Check,Clock,ReceiptText,RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clockTime,money,nextStatus,orderError,orderLabels,type OrderStatus,type StaffBoard,type StaffSession } from "@/lib/qr-orders";

const actionLabels:Partial<Record<OrderStatus,string>>={NEW:"Qəbul et",ACCEPTED:"Hazırlamağa başla",PREPARING:"Hazırdır",READY:"Servis edildi"};
export default function OrdersPanel({restaurantId,branchId,initialBoard}:{restaurantId:string;branchId:string;initialBoard:StaffBoard}) {
  const [board,setBoard]=useState(initialBoard),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[stale,setStale]=useState(false),[filter,setFilter]=useState("all");
  const actionRef=useRef(false),revision=useRef(0);
  const [denied,setDenied]=useState(false);
  async function reload() {
    if(actionRef.current)return;
    const generation=revision.current;
    const {data,error}=await createClient().rpc("qr_staff_board",{p_restaurant_id:restaurantId,p_branch_id:branchId});
    if(generation!==revision.current)return;
    if(error?.code==="42501"){setBoard({sessions:[]});setDenied(true);return;}
    if(error||!data){setStale(true);return;}
    setBoard(data as StaffBoard);setStale(false);
  }
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){if(stopped)return;if(document.visibilityState==="visible"&&!actionRef.current){
      const generation=revision.current;
      try{const {data,error}=await createClient().rpc("qr_staff_board",{p_restaurant_id:restaurantId,p_branch_id:branchId});if(!stopped&&generation===revision.current){if(error?.code==="42501"){setBoard({sessions:[]});setDenied(true);}else if(error||!data)setStale(true);else{setBoard(data as StaffBoard);setStale(false);}}}catch{if(!stopped)setStale(true);}
    }if(!stopped)timer=setTimeout(poll,4000);}
    void poll();const visible=()=>{if(document.visibilityState==="visible"){clearTimeout(timer);void poll();}};
    document.addEventListener("visibilitychange",visible);return()=>{stopped=true;clearTimeout(timer);document.removeEventListener("visibilitychange",visible);};
  },[restaurantId,branchId]);
  async function action(kind:string,id:string,version:number,status:string|null=null) {
    if(actionRef.current)return;actionRef.current=true;revision.current++;setBusy(id);setMessage("");
    try {
      const {data,error}=await createClient().rpc("qr_staff_action",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_kind:kind,p_id:id,p_version:version,p_status:status});
      if(error){if(error.code==="42501"){setBoard({sessions:[]});setDenied(true);}const code=error.code==="42501"?"FORBIDDEN":error.message;throw new Error(orderError(code));}
      if(!data)throw new Error(orderError());setBoard(data as StaffBoard);setStale(false);
    }catch(error){setMessage(error instanceof Error?error.message:orderError());}
    finally{actionRef.current=false;setBusy("");await reload().catch(()=>setStale(true));}
  }
  function close(session:StaffSession) {
    if(window.confirm(`${session.table_name}: ${money(session.total,session.currency)} ödənişi alındı? Təsdiqləsən masa bağlanacaq.`))void action("CLOSE",session.id,session.version);
  }
  const newOrders=board.sessions.flatMap(x=>x.orders).filter(x=>x.status==="NEW").length;
  const newCalls=board.sessions.flatMap(x=>x.services).filter(x=>x.status==="NEW").length;
  const shown=board.sessions.filter(x=>filter==="all"||filter==="new"&&x.orders.some(o=>o.status==="NEW")||filter==="calls"&&x.services.length>0);
  if(denied)return <section className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p role="alert" className="text-sm leading-6 text-red-800">Bu filiala girişin bağlanıb və ya təyinatın dəyişib. Cari filialını paneldən yoxla.</p><Link href="/admin" className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Panelə qayıt</Link></section>;
  return <>
    <div className="grid gap-3 sm:grid-cols-3"><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Yeni sifarişlər</p><p className="mt-2 text-2xl font-semibold text-emerald-800">{newOrders}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Yeni çağırışlar</p><p className="mt-2 text-2xl font-semibold text-amber-700">{newCalls}</p></div><div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">Açıq masalar</p><p className="mt-2 text-2xl font-semibold">{board.sessions.length}</p></div></div>
    <div className="flex flex-wrap items-center justify-between gap-3"><nav aria-label="Sifariş filtri" className="flex flex-wrap gap-2">{[{id:"all",name:"Bütün masalar"},{id:"new",name:"Yeni sifarişlər"},{id:"calls",name:"Çağırışlar"}].map(x=><button key={x.id} onClick={()=>setFilter(x.id)} aria-pressed={filter===x.id} className={`min-h-11 rounded-xl px-4 py-2 text-sm font-medium ${filter===x.id?"bg-emerald-800 text-white":"border border-slate-200 bg-white"}`}>{x.name}</button>)}</nav><div className="flex items-center gap-3"><span className={`text-xs ${stale?"text-red-700":"text-slate-500"}`}>{stale?"Bağlantı kəsilib — məlumat köhnə ola bilər":"4 saniyədən bir yenilənir"}</span><button aria-label="Paneli yenilə" onClick={()=>void reload().catch(()=>setStale(true))} disabled={!!busy} className="rounded-xl border border-slate-200 bg-white p-3"><RefreshCw size={16}/></button></div></div>
    {message&&<p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}
    {!shown.length&&<p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Bu bölmədə sifariş və çağırış yoxdur.</p>}
    <div className="grid items-start gap-5 xl:grid-cols-2">{shown.map(session=><section key={session.id} className={`overflow-hidden rounded-3xl border bg-white ${session.status==="BILL_REQUESTED"?"border-amber-300":"border-slate-200"}`}>
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="text-xl font-semibold">{session.table_name}</h2><p className="mt-1 text-xs text-slate-500">{session.status==="BILL_REQUESTED"?"Hesab istənilib":"Masa açıqdır"} · {clockTime(session.opened_at)}</p></div><div className="text-right"><p className="text-xs text-slate-500">Masa üzrə cəmi</p><p className="mt-1 text-lg font-semibold text-emerald-800">{money(session.total,session.currency)}</p></div></header>
      <div className="space-y-4 p-4 sm:p-5">{session.services.map(call=><div key={call.id} className={`rounded-2xl border p-4 ${call.kind==="BILL"?"border-amber-200 bg-amber-50":"border-emerald-100 bg-emerald-50"}`}><div className="flex items-center gap-2 font-semibold">{call.kind==="BILL"?<ReceiptText size={18}/>:<Bell size={18}/>}<span className="text-sm">{call.kind==="BILL"?"Hesab istənilir":"Ofisiant çağırılır"}</span><span className="ml-auto text-xs font-normal">{call.status==="NEW"?"Yeni":"Görüldü"}</span></div><div className="mt-3 flex flex-wrap gap-2">{call.status==="NEW"&&<button disabled={!!busy} onClick={()=>void action("SERVICE",call.id,call.version!,"SEEN")} className="min-h-11 rounded-xl bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-40">Gördüm</button>}{call.kind==="WAITER"&&call.status==="SEEN"&&<button disabled={!!busy} onClick={()=>void action("SERVICE",call.id,call.version!,"DONE")} className="min-h-11 rounded-xl bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-40">Çağırış tamamlandı</button>}</div></div>)}
      {session.orders.map(order=><article key={order.id} className="rounded-2xl border border-slate-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Sifariş #{order.number}</h3><span aria-live="polite" className={`rounded-full px-3 py-1.5 text-xs font-medium ${order.status==="CANCELLED"?"bg-red-50 text-red-700":order.status==="SERVED"?"bg-slate-100 text-slate-500":"bg-emerald-50 text-emerald-800"}`}>{orderLabels[order.status]}</span></div><p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400"><Clock size={12}/>{clockTime(order.created_at)}</p><div className="my-4 space-y-2 text-sm">{order.items.map((item,i)=><div key={i} className="flex justify-between gap-3"><span className="break-words text-slate-600">{item.quantity} × {item.name}</span><span className="shrink-0">{money(item.total,order.currency)}</span></div>)}</div>{order.note&&<p className="mb-4 break-words rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Qeyd: {order.note}</p>}<div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold"><span>Cəmi</span><span>{money(order.total,order.currency)}</span></div>{nextStatus[order.status]&&<div className="mt-4 flex flex-wrap gap-2"><button disabled={!!busy} onClick={()=>void action("ORDER",order.id,order.version,nextStatus[order.status]!)} className="min-h-11 flex-1 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy===order.id?"Yenilənir...":actionLabels[order.status]}</button><button disabled={!!busy} onClick={()=>{if(window.confirm(`Sifariş #${order.number} ləğv edilsin?`))void action("ORDER",order.id,order.version,"CANCELLED");}} className="min-h-11 rounded-xl border border-red-100 px-4 py-3 text-sm text-red-700 disabled:opacity-40">Ləğv et</button></div>}</article>)}
      {!session.orders.length&&<p className="py-3 text-center text-sm text-slate-400">Müştəri menyuya baxır. Hələ sifariş yoxdur.</p>}
      {session.status==="OPEN"&&session.orders.every(x=>x.status==="CANCELLED")&&<button disabled={!!busy} onClick={()=>{if(window.confirm(`${session.table_name} boşaldı? Sifarişsiz masa hesabı bağlanacaq.`))void action("CLEAR",session.id,session.version);}} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm disabled:opacity-40">Sifarişsiz masanı boşalt</button>}
      {session.status==="BILL_REQUESTED"&&<div className="space-y-2 border-t border-slate-100 pt-4"><button disabled={!!busy||session.orders.some(x=>!["SERVED","CANCELLED"].includes(x.status))} onClick={()=>close(session)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"><Check size={16}/>Ödəniş alındı · Masanı bağla</button><button disabled={!!busy} onClick={()=>void action("REOPEN",session.id,session.version)} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm">Əlavə sifariş üçün yenidən aç</button></div>}
      </div>
    </section>)}</div>
  </>;
}
