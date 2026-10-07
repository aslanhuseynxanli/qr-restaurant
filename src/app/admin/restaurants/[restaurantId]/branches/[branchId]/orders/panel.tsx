"use client";

import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import { Bell,Check,Clock,ReceiptText,RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clockTime,money,nextStatus,orderError,orderLabels,paymentLabels,type QROrder,type OrderStatus,type QRService,type StaffBoard,type StaffSession } from "@/lib/qr-orders";

import OrderSound from "./order-sound";
import PaymentDialog from "./payment-dialog";
import ManualOrder from "./manual-order";
import BillRequest from "./bill-request";
import {exactMoney,paymentErrors,type SettlementInput,type SettlementResult,type SettlementFeedback} from "@/lib/account-payments";

const actionLabels:Partial<Record<OrderStatus,string>>={NEW:"Qəbul et",ACCEPTED:"Hazırlamağa başla",PREPARING:"Hazırdır",READY:"Servis edildi"};
export default function OrdersPanel({restaurantId,branchId,initialBoard}:{restaurantId:string;branchId:string;initialBoard:StaffBoard}) {
  const [board,setBoard]=useState(initialBoard),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[stale,setStale]=useState(false),[filter,setFilter]=useState(initialBoard.can_prepare===true?"new":"ready"),[search,setSearch]=useState("");
  const [manual,setManual]=useState(false),[billSession,setBillSession]=useState<StaffSession|null>(null);
  const actionRef=useRef(false),revision=useRef(0);
  const [denied,setDenied]=useState(false),[paymentSession,setPaymentSession]=useState<StaffSession|null>(null),[notice,setNotice]=useState("");
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
    if(actionRef.current)return;actionRef.current=true;revision.current++;setBusy(id);setMessage("");setNotice("");
    try {
      const {data,error}=await createClient().rpc("qr_staff_action",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_kind:kind,p_id:id,p_version:version,p_status:status});
      if(error){if(error.code==="42501"){setBoard({sessions:[]});setDenied(true);}const code=error.code==="42501"?"FORBIDDEN":error.message;throw new Error(orderError(code));}
      if(!data)throw new Error(orderError());setBoard(data as StaffBoard);setStale(false);
    }catch(error){setMessage(error instanceof Error?error.message:orderError());}
    finally{actionRef.current=false;setBusy("");await reload().catch(()=>setStale(true));}
  }
  async function settle(input:SettlementInput):Promise<SettlementFeedback> {
    if(actionRef.current)return {ok:false,error:"Başqa əməliyyat tamamlanır. Bir az sonra yenidən yoxla.",retry:true};
    actionRef.current=true;revision.current++;setBusy(input.session_id);setNotice("");setMessage("");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try {
      const {data,error}=await createClient().rpc("qr_settle_account",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_session_id:input.session_id,
        p_version:input.version,p_request_id:input.request_id,p_payment_method:input.method,p_cash:input.cash,p_card:input.card,p_expected_total:input.total,p_currency:input.currency}).abortSignal(controller.signal);
      if(error){
        if(error.code==="42501"){setBoard({sessions:[]});setDenied(true);return {ok:false,error:paymentErrors.FORBIDDEN};}
        if(Object.hasOwn(paymentErrors,error.message))return {ok:false,error:paymentErrors[error.message]};
        return {ok:false,error:"Cavab alınmadı. Eyni ödənişi yenidən yoxla; təkrar ödəniş qeydi yaranmayacaq.",retry:true};
      }
      if(!data)return {ok:false,error:"Cavab alınmadı. Eyni ödənişi yenidən yoxla.",retry:true};
      const result=data as SettlementResult;setBoard(result.board);setStale(false);
      setNotice(`${paymentSession?.table_name||"Masa"} · Hesab #${result.payment.number} bağlandı · ${exactMoney(result.payment.total,result.payment.currency)}. Ödəniş qeydə alındı.`);
      return {ok:true};
    }catch{return {ok:false,error:"Bağlantı alınmadı. Eyni ödənişi yenidən yoxla; təkrar qeyd yaranmayacaq.",retry:true};}
    finally{clearTimeout(timer);actionRef.current=false;setBusy("");void reload().catch(()=>setStale(true));}
  }
  const allOrders=board.sessions.flatMap(session=>session.orders.map(order=>({session,order})));
  const newOrders=allOrders.filter(x=>x.order.status==="NEW").length;
  const workingOrders=allOrders.filter(x=>["ACCEPTED","PREPARING","READY"].includes(x.order.status)).length;
  const readyOrders=allOrders.filter(x=>x.order.status==="READY").length;
  const newCalls=board.sessions.flatMap(x=>x.services).filter(x=>x.status==="NEW").length;
  const needle=search.trim().toLocaleLowerCase("az");
  const matches=(session:StaffSession,order?:QROrder)=>!needle||session.table_name.toLocaleLowerCase("az").includes(needle)||String(session.table_number)===needle||Boolean(order&&String(order.number).includes(needle.replace(/^#/,"")));
  const queue=allOrders.filter(x=>matches(x.session,x.order)&&(filter==="new"?x.order.status==="NEW":filter==="ready"?x.order.status==="READY":["ACCEPTED","PREPARING","READY"].includes(x.order.status)))
    .sort((a,b)=>a.order.created_at.localeCompare(b.order.created_at)||a.order.number-b.order.number);
  const shown=board.sessions.filter(s=>matches(s)||s.orders.some(o=>matches(s,o))).filter(s=>filter!=="calls"||s.services.length>0);
  function orderCard(order:QROrder,session:StaffSession,standalone=false) {
    return <article key={order.id} aria-label={`${session.table_name} · Sifariş #${order.number}`} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><div>{standalone&&<p className="mb-1 text-lg font-bold text-emerald-900">{session.table_name}</p>}<h3 className="text-sm font-semibold">Sifariş #{order.number}</h3></div><span className={`rounded-full px-3 py-1.5 text-xs font-medium ${order.status==="CANCELLED"?"bg-red-50 text-red-700":order.status==="SERVED"?"bg-slate-100 text-slate-500":order.status==="READY"?"bg-amber-100 text-amber-900":"bg-emerald-50 text-emerald-800"}`}>{orderLabels[order.status]}</span></div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500"><Clock size={12}/>{clockTime(order.created_at)}</p>
      <div className="my-4 space-y-2 text-sm">{order.items.map((item,i)=><div key={i} className="flex justify-between gap-3"><span className="min-w-0 break-words text-slate-600"><strong className="text-slate-900">{item.quantity} ×</strong> {item.name}</span><span className="shrink-0">{money(item.total,order.currency)}</span></div>)}</div>
      {order.note&&<p className="mb-4 break-words rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Qeyd: {order.note}</p>}
      <div className="flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold"><span>Cəmi</span><span>{money(order.total,order.currency)}</span></div>
      {nextStatus[order.status]&&<div className="mt-4 flex flex-wrap gap-2">{(order.status==="READY"||board.can_prepare===true)&&<button disabled={!!busy} onClick={()=>void action("ORDER",order.id,order.version,nextStatus[order.status]!)} className="min-h-11 flex-1 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy===order.id?"Yenilənir...":actionLabels[order.status]}</button>}<button disabled={!!busy} onClick={()=>{if(window.confirm(`${session.table_name}: Sifariş #${order.number} ləğv edilsin?`))void action("ORDER",order.id,order.version,"CANCELLED");}} className="min-h-11 rounded-xl border border-red-100 px-4 py-3 text-sm text-red-700 disabled:opacity-40">Ləğv et</button></div>}
    </article>;
  }
  function serviceCard(call:QRService) {
    return <div key={call.id} className={`rounded-2xl border p-4 ${call.kind==="BILL"?"border-amber-200 bg-amber-50":"border-emerald-100 bg-emerald-50"}`}><div className="flex flex-wrap items-center gap-2 font-semibold">{call.kind==="BILL"?<ReceiptText size={18}/>:<Bell size={18}/>}<span className="text-sm">{call.kind==="BILL"?"Hesab istənilir":"Ofisiant çağırılır"}</span><span className="ml-auto text-xs font-normal">{clockTime(call.created_at)} · {call.status==="NEW"?"Yeni":"Görüldü"}</span></div>
      {call.kind==="BILL"&&<p className="mt-3 text-sm font-semibold text-amber-900">Ödəniş: {call.payment_method?paymentLabels[call.payment_method]:"Üsul seçilməyib · müştəridən soruş"}</p>}
      <div className="mt-3 flex flex-wrap gap-2">{call.status==="NEW"&&<button disabled={!!busy} onClick={()=>void action("SERVICE",call.id,call.version!,"SEEN")} className="min-h-11 rounded-xl bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-40">Gördüm</button>}{call.kind==="WAITER"&&call.status==="SEEN"&&<button disabled={!!busy} onClick={()=>void action("SERVICE",call.id,call.version!,"DONE")} className="min-h-11 rounded-xl bg-white px-4 py-2 text-sm font-medium shadow-sm disabled:opacity-40">Çağırış tamamlandı</button>}</div>
    </div>;
  }
  if(denied)return <section className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p role="alert" className="text-sm leading-6 text-red-800">Bu filiala girişin bağlanıb və ya təyinatın dəyişib. Cari filialını paneldən yoxla.</p><Link href="/admin" className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Panelə qayıt</Link></section>;
  const tabs=board.can_prepare===true?[{id:"new",name:"Yeni sifarişlər",count:newOrders},{id:"work",name:"Hazırlananlar",count:workingOrders},{id:"all",name:"Masalar",count:board.sessions.length},{id:"calls",name:"Çağırışlar",count:newCalls}]:[{id:"ready",name:"Hazır sifarişlər",count:readyOrders},{id:"calls",name:"Çağırışlar",count:newCalls},{id:"all",name:"Masalar",count:board.sessions.length}];
  return <>
    <OrderSound board={board}/>
    <button disabled={!!busy} onClick={()=>setManual(true)} className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white disabled:opacity-40 sm:w-auto">Masa üçün sifariş əlavə et</button>
    {manual&&<ManualOrder restaurantId={restaurantId} branchId={branchId} onClose={()=>setManual(false)} onSuccess={receipt=>{revision.current++;setManual(false);setNotice(`${receipt.table_name} · Sifariş #${receipt.number} mətbəxə göndərildi.`);void reload().catch(()=>setStale(true));}}/>}
    {billSession&&<BillRequest restaurantId={restaurantId} branchId={branchId} session={billSession} onClose={()=>{setBillSession(null);void reload().catch(()=>setStale(true));}} onSuccess={data=>{revision.current++;setBoard(data);setBillSession(null);setStale(false);}}/>}
    {paymentSession&&<PaymentDialog session={paymentSession} onClose={()=>setPaymentSession(null)} onSettle={settle}/>}
    {notice&&<p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">{notice}</p>}
    <div className="space-y-3 rounded-2xl border border-slate-200 bg-white p-3 sm:p-4">
      <nav aria-label="Sifariş filtri" className={`grid grid-cols-2 gap-2 ${board.can_prepare===true?"sm:grid-cols-4":"sm:grid-cols-3"}`}>{tabs.map(x=><button key={x.id} onClick={()=>setFilter(x.id)} aria-pressed={filter===x.id} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${filter===x.id?"bg-emerald-800 text-white":"bg-slate-50 text-slate-700"}`}>{x.name}<span className={`rounded-md px-2 py-0.5 text-xs ${filter===x.id?"bg-white/15":"bg-slate-200/70"}`}>{x.count}</span></button>)}</nav>
      <div className="flex flex-wrap items-center justify-between gap-3"><input aria-label="Masa və ya sifariş axtar" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Masa adı və ya sifariş nömrəsi" className="min-h-11 w-full rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-emerald-600 sm:max-w-sm"/><div className="flex items-center gap-3"><span className={`text-xs ${stale?"text-red-700":"text-slate-500"}`}>{stale?"Bağlantı kəsilib — məlumat köhnə ola bilər":"4 saniyədən bir yenilənir"}</span><button aria-label="Paneli yenilə" onClick={()=>void reload().catch(()=>setStale(true))} disabled={!!busy} className="rounded-xl border border-slate-200 bg-white p-3"><RefreshCw size={16}/></button></div></div>
    </div>
    {message&&<p role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-800">{message}</p>}
    {(filter==="new"||filter==="work"||filter==="ready")?<><p className="text-xs text-slate-500">Əvvəl gələn sifariş yuxarıdadır. Hər sifarişdə masa adı ayrıca göstərilir.</p>{!queue.length&&<p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{needle?"Axtarışa uyğun sifariş yoxdur.":filter==="new"?"Yeni sifariş yoxdur.":filter==="ready"?"Hazır sifariş yoxdur.":"Hazırlanan sifariş yoxdur."}</p>}<div className="grid items-start gap-4 lg:grid-cols-2 2xl:grid-cols-3">{queue.map(({session,order})=>orderCard(order,session,true))}</div></>:<>
      {!shown.length&&<p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">{needle?"Axtarışa uyğun masa yoxdur.":filter==="calls"?"Çağırış yoxdur.":"Açıq masa yoxdur."}</p>}
      <div className="grid items-start gap-5 xl:grid-cols-2">{shown.map(session=><section key={session.id} className={`min-w-0 overflow-hidden rounded-3xl border bg-white ${session.status==="BILL_REQUESTED"?"border-amber-300":"border-slate-200"}`}>
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-5"><div><h2 className="text-xl font-semibold">{session.table_name}</h2><p className="mt-1 text-xs text-slate-500">{session.status==="BILL_REQUESTED"?"Hesab istənilib":"Masa açıqdır"} · {clockTime(session.opened_at)}</p></div><div className="text-right"><p className="text-xs text-slate-500">Masa üzrə cəmi</p><p className="mt-1 text-lg font-semibold text-emerald-800">{money(session.total,session.currency)}</p></div></header>
        <div className="space-y-4 p-4 sm:p-5">{session.services.map(serviceCard)}
          {filter==="all"&&<>{session.orders.filter(o=>!["SERVED","CANCELLED"].includes(o.status)).map(o=>orderCard(o,session))}
          {session.orders.some(o=>["SERVED","CANCELLED"].includes(o.status))&&<details className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-medium">Tamamlanan sifarişlər ({session.orders.filter(o=>["SERVED","CANCELLED"].includes(o.status)).length})</summary><div className="mt-4 space-y-3">{session.orders.filter(o=>["SERVED","CANCELLED"].includes(o.status)).map(o=>orderCard(o,session))}</div></details>}
          {!session.orders.length&&<p className="py-3 text-center text-sm text-slate-400">Müştəri menyuya baxır. Hələ sifariş yoxdur.</p>}</>}
          {session.orders.every(x=>x.status==="CANCELLED")&&<button disabled={!!busy} onClick={()=>{if(window.confirm(`${session.table_name} boşaldı? Sifarişsiz masa hesabı bağlanacaq.`))void action("CLEAR",session.id,session.version);}} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm disabled:opacity-40">Sifarişsiz masanı boşalt</button>}
          {filter==="all"&&session.status==="OPEN"&&session.orders.some(x=>x.status!=="CANCELLED")&&<button disabled={!!busy} onClick={()=>setBillSession(session)} className="min-h-12 w-full rounded-xl border border-emerald-200 px-4 py-3 font-semibold text-emerald-800">Hesabı hazırla</button>}
          {session.status==="BILL_REQUESTED"&&<div className="space-y-2 border-t border-slate-100 pt-4"><button disabled={!!busy||!session.orders.some(x=>x.status==="SERVED")||session.orders.some(x=>!["SERVED","CANCELLED"].includes(x.status))} onClick={()=>setPaymentSession(session)} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"><Check size={16}/>Ödəniş alındı · Masanı bağla</button>{session.orders.some(x=>!["SERVED","CANCELLED"].includes(x.status))&&<p className="text-xs leading-5 text-slate-500">Masanı bağlamazdan əvvəl bütün sifarişləri servis et və ya ləğv et.</p>}<button disabled={!!busy} onClick={()=>void action("REOPEN",session.id,session.version)} className="min-h-11 w-full rounded-xl border border-slate-200 px-4 py-3 text-sm">Əlavə sifariş üçün yenidən aç</button></div>}
        </div>
      </section>)}</div>
    </>}
  </>;
}
