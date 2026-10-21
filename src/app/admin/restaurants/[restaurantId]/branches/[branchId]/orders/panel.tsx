"use client";
import PaymentAllocationCorrection from "@/components/payment-allocation-correction";

import { useEffect,useRef,useState } from "react";
import Link from "next/link";
import {Badge,EmptyState} from "@/components/portal-ui";
import { Bell,Check,Clock,ReceiptText,RefreshCw,Plus,ArrowUpRight,Search,ChefHat } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { clockTime,money,nextStatus,orderError,orderLabels,paymentLabels,type QROrder,type OrderStatus,type QRService,type StaffBoard,type StaffSession } from "@/lib/qr-orders";

import OperationDialog from "./operation-dialog";
import OrderChanges from "@/components/order-changes";
import AccountBreakdown from "@/components/account-breakdown";
import OrderSound from "./order-sound";
import PaymentDialog from "./payment-dialog";
import ManualOrder from "./manual-order";
import BillRequest from "./bill-request";
import {exactMoney,paymentErrors,type SettlementInput,type SettlementResult,type SettlementFeedback} from "@/lib/account-payments";

const actionLabels:Partial<Record<OrderStatus,string>>={NEW:"Qəbul et",ACCEPTED:"Hazırlamağa başla",PREPARING:"Hazırdır",READY:"Servis edildi"};
export default function OrdersPanel({restaurantId,branchId,branchName,userId,initialBoard,canCorrectPayment}:{restaurantId:string;branchId:string;branchName:string;userId:string;initialBoard:StaffBoard;canCorrectPayment:boolean}) {
  const [board,setBoard]=useState(initialBoard),[busy,setBusy]=useState(""),[message,setMessage]=useState(""),[stale,setStale]=useState(false),[filter,setFilter]=useState(initialBoard.can_prepare===true?"new":"ready"),[search,setSearch]=useState("");
  const [manual,setManual]=useState(false),[billSession,setBillSession]=useState<StaffSession|null>(null);
  const [operation,setOperation]=useState<{kind:"items"|"move"|"bill"|"part";session:StaffSession;order?:QROrder}|null>(null);
  const receiptURL=(id:string)=>`/admin/restaurants/${restaurantId}/branches/${branchId}/orders/receipt/${id}`;
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
  const locked=!!busy||stale;
  function orderCard(order:QROrder,session:StaffSession,standalone=false){
    const tone=order.status==="READY"?"amber":order.status==="CANCELLED"?"red":order.status==="SERVED"?"neutral":order.status==="NEW"?"teal":"blue";
    return <article key={order.id} aria-label={`${session.table_name} · Sifariş #${order.number}`} className="portal-work-card"><header><div className="min-w-0"><h3>{standalone?session.table_name:`Sifariş #${order.number}`}</h3><p className="portal-help mt-1">{standalone?`Sifariş #${order.number} · `:""}{clockTime(order.created_at)}</p></div><Badge tone={tone}>{orderLabels[order.status]}</Badge></header><div className="portal-work-card-body"><ul>{order.items.map((item,i)=><li key={i} className="portal-work-item"><b>{item.quantity===0?"Ləğv":`${item.quantity}×`}</b><span>{item.name}</span><small className="shrink-0 text-[11px] text-slate-400">{money(item.total,order.currency)}</small></li>)}</ul><OrderChanges changes={order.changes}/>{order.note&&<p className="portal-work-note">Qeyd: {order.note}</p>}</div><footer className="portal-work-card-footer"><span>Cəmi</span><strong>{money(order.total,order.currency)}</strong></footer>{nextStatus[order.status]&&<div className="portal-work-card-action space-y-2">{(order.status==="READY"||board.can_prepare===true)&&<button disabled={locked} onClick={()=>void action("ORDER",order.id,order.version,nextStatus[order.status]!)} className={`portal-btn ${order.status==="READY"?"portal-btn-primary":"portal-btn-dark"}`}>{order.status==="READY"&&<Check size={14}/>} {busy===order.id?"Yenilənir…":actionLabels[order.status]}</button>}</div>}{order.status!=="CANCELLED"&&(order.status!=="SERVED"||board.viewer_role==="OWNER")&&!session.parts?.length&&<div className="p-3"><button disabled={locked} onClick={()=>setOperation({kind:"items",session,order})} className="portal-btn w-full">Məhsulları düzəlt / ləğv et</button></div>}</article>;
  }
  function serviceCard(call:QRService,session:StaffSession){return <article key={call.id} aria-label={`${session.table_name} · ${call.kind==="BILL"?"Hesab istəyi":"Ofisiant çağırışı"}`} className={`portal-call-card portal-tone-${call.kind==="BILL"?"purple":"amber"}`}><header><div className="min-w-0"><h2>{session.table_name}</h2><p>{call.kind==="BILL"?"Hesab istənilir":"Ofisiant çağırılır"}</p></div>{call.kind==="BILL"?<ReceiptText size={20}/>:<Bell size={20}/>}</header><div className="portal-call-card-body"><div className="flex flex-wrap items-center justify-between gap-2"><p className="portal-help"><Clock size={11} className="mr-1 inline"/>{clockTime(call.created_at)}</p><Badge tone={call.status==="NEW"?"amber":"neutral"}>{call.status==="NEW"?"Yeni":"Görüldü"}</Badge></div>{call.kind==="BILL"&&<p className="mt-4 text-xs font-bold">Ödəniş: {call.payment_method?paymentLabels[call.payment_method]:"Müştəridən soruş"}<span className="ml-2 text-slate-500">{money(session.total,session.currency)}</span></p>}<div className="portal-call-card-actions">{call.status==="NEW"&&<button disabled={locked} onClick={()=>void action("SERVICE",call.id,call.version!,"SEEN")} className="portal-btn portal-btn-soft">Gördüm</button>}{call.kind==="WAITER"&&call.status==="SEEN"&&<button disabled={locked} onClick={()=>void action("SERVICE",call.id,call.version!,"DONE")} className="portal-btn portal-btn-primary"><Check size={13}/>Çağırış tamamlandı</button>}{call.kind==="BILL"&&session.status==="BILL_REQUESTED"&&<button disabled={locked||!session.orders.some(o=>o.status==="SERVED")||session.orders.some(o=>!["SERVED","CANCELLED"].includes(o.status))} onClick={()=>setPaymentSession(session)} className="portal-btn portal-btn-dark">Ödənişi təsdiqlə</button>}</div>{call.kind==="BILL"&&session.orders.some(o=>!["SERVED","CANCELLED"].includes(o.status))&&<p className="portal-help mt-3">Ödənişdən əvvəl bütün sifarişləri servis et.</p>}</div></article>;}
  if(denied)return <section className="portal-notice portal-notice-error space-y-3"><p role="alert">Bu filiala girişin bağlanıb və ya təyinatın dəyişib. Cari filialını paneldən yoxla.</p><Link href="/admin" className="portal-btn">Panelə qayıt</Link></section>;
  const tabs=board.can_prepare===true?[{id:"new",name:"Yeni sifarişlər",count:newOrders},{id:"work",name:"İcrada və hazır",count:workingOrders},{id:"all",name:"Masalar",count:board.sessions.length},{id:"calls",name:"Çağırışlar",count:newCalls}]:[{id:"ready",name:"Hazır sifarişlər",count:readyOrders},{id:"calls",name:"Çağırışlar",count:newCalls},{id:"all",name:"Masalar",count:board.sessions.length}];
  const calls=shown.flatMap(session=>session.services.map(call=>({session,call}))).sort((a,b)=>a.call.created_at.localeCompare(b.call.created_at));
  return <div className="space-y-5"><header className="portal-operations-heading"><div><p className="portal-eyebrow">Servis və masalar</p><h1>Ofisiant paneli</h1><p>{branchName} · Hazır yeməklər, çağırışlar və hesablar</p></div><div className="flex flex-wrap items-center gap-3"><OrderSound board={board}/><button disabled={locked} onClick={()=>setManual(true)} className="portal-btn portal-btn-primary"><Plus size={15}/>Masa üçün sifariş əlavə et</button></div></header>
    {operation&&<OperationDialog {...operation} restaurantId={restaurantId} branchId={branchId} userId={userId} board={board} onClose={()=>{setOperation(null);void reload().catch(()=>setStale(true));}} onSuccess={(data,closed)=>{revision.current++;setBoard(data);setOperation(null);setStale(false);setNotice(closed?"Ödəniş tamamlandı və masa bağlandı.":"Əməliyyat tamamlandı. Cari hesab yeniləndi.");}}/>}
    {manual&&<ManualOrder restaurantId={restaurantId} branchId={branchId} onClose={()=>setManual(false)} onSuccess={receipt=>{revision.current++;setManual(false);setNotice(`${receipt.table_name} · Sifariş #${receipt.number} mətbəxə göndərildi.`);void reload().catch(()=>setStale(true));}}/>}
    {billSession&&<BillRequest restaurantId={restaurantId} branchId={branchId} session={billSession} onClose={()=>{setBillSession(null);void reload().catch(()=>setStale(true));}} onSuccess={data=>{revision.current++;setBoard(data);setBillSession(null);setStale(false);}}/>}
    {paymentSession&&<PaymentDialog session={paymentSession} onClose={()=>setPaymentSession(null)} onSettle={settle}/>}
    {notice&&<p role="status" className="portal-notice">{notice}</p>}{message&&<p role="alert" className="portal-notice portal-notice-error">{message}</p>}{stale&&<p role="alert" className="portal-notice portal-notice-warning">Bağlantı alınmadı. Son vəziyyət göstərilir; əməliyyatdan əvvəl paneli yenilə.</p>}
    <div className="portal-work-filters"><nav aria-label="Sifariş filtri" className="portal-segmented">{tabs.map(t=><button type="button" key={t.id} onClick={()=>setFilter(t.id)} aria-pressed={filter===t.id}>{t.name}<span>{t.count}</span></button>)}</nav><div className="flex min-w-0 flex-wrap items-center gap-2"><div className="portal-search"><Search size={15}/><input aria-label="Masa və ya sifariş axtar" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Masa adı və ya #sifariş" className="portal-input"/></div><button aria-label="Paneli yenilə" disabled={!!busy} onClick={()=>void reload().catch(()=>setStale(true))} className="portal-btn"><RefreshCw size={14}/></button></div></div>
    <div className="portal-toolbar"><p className="portal-help">Əvvəl gələn sifariş yuxarıdadır. Statuslar avtomatik yenilənir.</p>{board.can_prepare===true&&<Link href={`/admin/restaurants/${restaurantId}/branches/${branchId}/kitchen`} className="portal-link"><ChefHat size={13}/>Mətbəx ekranı<ArrowUpRight size={13}/></Link>}</div>
    {(filter==="new"||filter==="work"||filter==="ready")?<>{queue.length?<div className="portal-workspace-grid">{queue.map(({session,order})=>orderCard(order,session,true))}</div>:<EmptyState title={needle?"Uyğun sifariş tapılmadı":filter==="new"?"Yeni sifariş yoxdur":filter==="ready"?"Hazır sifariş yoxdur":"İcrada sifariş yoxdur"} description={needle?"Masa adı və ya sifariş nömrəsini dəyiş.":"Sifarişin statusu yenilənəndə burada görünəcək."}/>}</>:filter==="calls"?<>{calls.length?<div className="portal-call-grid">{calls.map(({session,call})=>serviceCard(call,session))}</div>:<EmptyState title="Çağırış yoxdur" description="Ofisiant və hesab çağırışları burada görünəcək." icon={<Bell size={24}/>}/>}</>:<>
    {!shown.length&&<EmptyState title={needle?"Uyğun masa tapılmadı":"Açıq masa yoxdur"} description="Müştərinin və ya ofisiantın açdığı masa hesabları burada görünəcək."/>}<div className="grid items-start gap-5 lg:grid-cols-2">{shown.slice().sort((a,b)=>(a.status==="BILL_REQUESTED"?0:1)-(b.status==="BILL_REQUESTED"?0:1)||a.table_number-b.table_number).map(session=><section key={session.id} aria-label={session.table_name} className="portal-panel space-y-4"><header className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-extrabold">{session.table_name}</h2><p className="portal-help mt-1">{clockTime(session.opened_at)} · {session.status==="BILL_REQUESTED"?"Hesab istənilib":"Masa açıqdır"}</p></div><div className="text-right"><p className="portal-help">Masa üzrə cəmi</p><strong className="text-lg font-extrabold text-emerald-800">{money(session.total,session.currency)}</strong></div></header>
      <AccountBreakdown totals={session.totals}/>{canCorrectPayment&&board.viewer_role==="OWNER"&&!!session.parts?.length&&<PaymentAllocationCorrection restaurantId={restaurantId} sessionId={session.id} disabled={locked} onUpdated={()=>{revision.current++;void reload().catch(()=>setStale(true));}}/>}<div className="flex flex-wrap gap-2"><Link target="_blank" rel="noopener noreferrer" href={receiptURL(session.id)} className="portal-btn">Hesabı aç / Çap et</Link>{!session.parts?.length&&<><button disabled={locked} onClick={()=>setOperation({kind:"move",session})} className="portal-btn">Masanı dəyiş</button>{board.viewer_role==="OWNER"&&session.orders.some(o=>o.status!=="CANCELLED")&&<button disabled={locked} onClick={()=>setOperation({kind:"bill",session})} className="portal-btn">Endirim / Servis haqqı</button>}</>}</div>
      {!!session.parts?.length&&<details className="rounded-xl bg-emerald-50 p-3 text-sm"><summary className="cursor-pointer font-semibold">Alınmış ödənişlər ({session.parts.length})</summary><ul className="mt-3 space-y-2">{session.parts.map((p,i)=><li key={p.id||i}>{p.label||`Hissə ${i+1}`} · Nağd {exactMoney(p.cash,session.currency)} · Kart {exactMoney(p.card,session.currency)} · {clockTime(p.at)}</li>)}</ul></details>}
      {session.services.length>0&&<div className="space-y-3">{session.services.map(call=>serviceCard(call,session))}</div>}
      <div className="space-y-3">{session.orders.filter(o=>!["SERVED","CANCELLED"].includes(o.status)).map(o=>orderCard(o,session))}</div>
      {session.orders.some(o=>["SERVED","CANCELLED"].includes(o.status))&&<details className="rounded-xl bg-slate-50 p-3"><summary className="min-h-9 cursor-pointer py-2 text-[11px] font-bold text-slate-500">Tamamlanan sifarişlər ({session.orders.filter(o=>["SERVED","CANCELLED"].includes(o.status)).length})</summary><div className="mt-3 space-y-3">{session.orders.filter(o=>["SERVED","CANCELLED"].includes(o.status)).map(o=>orderCard(o,session))}</div></details>}
      {!session.orders.length&&<p className="portal-help py-3">Müştəri menyuya baxır. Hələ sifariş yoxdur.</p>}
      {session.orders.every(o=>o.status==="CANCELLED")&&<button disabled={locked} onClick={()=>{if(window.confirm(`${session.table_name} boşaldı? Sifarişsiz masa hesabı bağlanacaq.`))void action("CLEAR",session.id,session.version);}} className="portal-btn w-full">Sifarişsiz masanı boşalt</button>}
      {session.status==="OPEN"&&session.orders.some(o=>o.status!=="CANCELLED")&&<button disabled={locked} onClick={()=>setBillSession(session)} className="portal-btn portal-btn-soft w-full"><ReceiptText size={14}/>Hesabı hazırla</button>}
      {session.status==="BILL_REQUESTED"&&<div className="space-y-3 border-t border-slate-100 pt-4"><button disabled={locked||!session.orders.some(o=>o.status==="SERVED")||session.orders.some(o=>!["SERVED","CANCELLED"].includes(o.status))} onClick={()=>setPaymentSession(session)} className="portal-btn portal-btn-dark w-full"><Check size={14}/>Ödəniş alındı · Masanı bağla</button>{session.orders.some(o=>!["SERVED","CANCELLED"].includes(o.status))&&<p className="portal-help">Masanı bağlamazdan əvvəl bütün sifarişləri servis et və ya ləğv et.</p>}{!session.parts?.length&&<button disabled={locked} onClick={()=>void action("REOPEN",session.id,session.version)} className="portal-btn w-full">Əlavə sifariş üçün yenidən aç</button>}<button disabled={locked||session.orders.some(o=>!["SERVED","CANCELLED"].includes(o.status))||!session.orders.some(o=>o.status==="SERVED")} onClick={()=>setOperation({kind:"part",session})} className="portal-btn w-full">Hesabı böl / Hissə ödənişi al</button></div>}
    </section>)}</div>
    </>}
  </div>;
}
