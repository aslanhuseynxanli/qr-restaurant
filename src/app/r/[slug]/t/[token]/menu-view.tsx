"use client";

import { useCallback,useEffect,useRef,useState,useSyncExternalStore } from "react";
import Image from "next/image";
import { Bell,Check,ChevronRight,Clock,MapPin,Minus,Plus,ReceiptText,Search,ShoppingBag,UtensilsCrossed,X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { QRMenu } from "@/lib/qr-menu";
import { isPaymentMethod,money,orderError,orderLabels,orderSteps,paymentLabels,type PaymentMethod,type CartLine,type VisitView } from "@/lib/qr-orders";

type Pending={id:string;items:{id:string;quantity:number;price:string}[];currency:string;note:string};
type Draft={lines:CartLine[];note:string;pending:Pending|null;service:{id:string;kind:"WAITER"|"BILL";paymentMethod?:PaymentMethod}|null};
const emptyDraft=():Draft=>({lines:[],note:"",pending:null,service:null});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function readDraft(key:string):Draft {
  if(typeof window==="undefined")return emptyDraft();
  try {
    const value=localStorage.getItem(key);if(!value||value.length>65536)return emptyDraft();
    const data=JSON.parse(value) as Draft;
    if(!Array.isArray(data.lines)||data.lines.length>50||data.lines.some(x=>!uuid.test(x.id)||typeof x.name!=="string"||x.name.length>200||!Number.isInteger(x.quantity)||x.quantity<1||x.quantity>20||!Number.isFinite(x.price)||x.price<0)||typeof data.note!=="string"||data.note.length>500)return emptyDraft();
    if(data.pending&&(!uuid.test(data.pending.id)||!Array.isArray(data.pending.items)||data.pending.items.length>50||typeof data.pending.currency!=="string"||data.pending.currency.length>10||typeof data.pending.note!=="string"||data.pending.note.length>500))return emptyDraft();
    if(data.service&&(!uuid.test(data.service.id)||!["WAITER","BILL"].includes(data.service.kind)||data.service.paymentMethod!==undefined&&!isPaymentMethod(data.service.paymentMethod)))return emptyDraft();
    return {...emptyDraft(),...data};
  }catch{return emptyDraft();}
}
const subscribeHydration=()=>()=>{};
class APIError extends Error { constructor(public code:string){super(orderError(code));} }
async function api(endpoint:string,body?:Record<string,unknown>) {
  const result=await fetch(endpoint,{method:body?"POST":"GET",mode:"same-origin",referrerPolicy:"strict-origin",credentials:"same-origin",cache:"no-store",headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const data=await result.json();if(!result.ok)throw new APIError(data.error||"REQUEST_FAILED");return data as {view:VisitView|null;orderId?:string};
}
function gps(required:boolean):Promise<{latitude:number|null;longitude:number|null}> {
  if(!required)return Promise.resolve({latitude:null,longitude:null});
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){reject(new APIError("LOCATION_REQUIRED"));return;}
    navigator.geolocation.getCurrentPosition(p=>resolve({latitude:p.coords.latitude,longitude:p.coords.longitude}),()=>reject(new APIError("LOCATION_REQUIRED")),{enableHighAccuracy:true,maximumAge:0,timeout:15000});
  });
}

export default function MenuView({slug,token,initialMenu}:{slug:string;token:string;initialMenu:QRMenu}) {
  const endpoint=`/api/qr/${slug}/${token}`,storageKey=`qr-cart-v1:${slug}:${token}`;
  const hydrated=useSyncExternalStore(subscribeHydration,()=>true,()=>false);
  const [menu,setMenu]=useState(initialMenu),[draft,setDraft]=useState(()=>readDraft(storageKey)),[visit,setVisit]=useState<VisitView|null>(null);
  const [paymentMethod,setPaymentMethod]=useState<PaymentMethod|null>(null);
  const [search,setSearch]=useState(""),[category,setCategory]=useState("all"),[modal,setModal]=useState<"cart"|"bill"|null>(null);
  const [busy,setBusy]=useState(""),[message,setMessage]=useState(""),[notice,setNotice]=useState(""),[stale,setStale]=useState(false),[expired,setExpired]=useState(false);
  const draftRef=useRef(draft),busyRef=useRef(false),dialogRef=useRef<HTMLDialogElement>(null),sessionRef=useRef<string|null>(null);
  const visible=["ALLOWED","NOT_REQUIRED"].includes(menu.location.status);
  const shownDraft=hydrated?draft:emptyDraft(),lines=shownDraft.lines,locked=Boolean(shownDraft.pending),total=lines.reduce((sum,x)=>sum+Math.round(x.price*100)*x.quantity,0)/100,count=lines.reduce((sum,x)=>sum+x.quantity,0);
  const canAdd=visible&&menu.can_order&&(!visit||visit.session.status==="OPEN")&&!busy&&!locked;

  const commit=useCallback((next:Draft,required=false)=>{
    try{localStorage.setItem(storageKey,JSON.stringify(next));}catch{if(required)throw new Error("Brauzerdə məlumat saxlamaq mümkün olmadı. Sifarişi göndərmək üçün adi brauzer pəncərəsində aç.");}
    draftRef.current=next;setDraft(next);
  },[storageKey]);
  const acceptView=useCallback((view:VisitView|null)=>{
    setVisit(view);setStale(false);setExpired(false);
    let current=draftRef.current;
    if(view&&sessionRef.current&&sessionRef.current!==view.session.id&&!current.pending){current=emptyDraft();commit(current);}
    if(view)sessionRef.current=view.session.id;
    if(current.pending&&view?.orders.some(o=>o.request_id===current.pending!.id)) {
      commit({...current,lines:[],note:"",pending:null});setNotice("Sifarişin restorana çatdı. Statusunu aşağıda izləyə bilərsən.");
    }else if(current.service&&view?.services.some(s=>s.kind===current.service!.kind)){
      const requested=current.service,confirmed=view.services.find(s=>s.kind===requested.kind)!;
      commit({...current,service:null});
      if(requested.kind==="BILL"){
        setModal(null);setMessage("");
        setNotice(`Masa üçün hesab istənildi.${confirmed.payment_method?` Ödəniş: ${paymentLabels[confirmed.payment_method]}.`:""} Ofisiant yaxınlaşacaq.`);
      }
    }
  },[commit]);
  useEffect(()=>{
    let stopped=false,timer:ReturnType<typeof setTimeout>;
    async function poll(){
      if(stopped)return;
      if(document.visibilityState==="visible")try{const data=await api(endpoint);if(!stopped)acceptView(data.view);}catch(error){if(!stopped){setStale(true);if(error instanceof APIError&&error.code==="VISIT_EXPIRED")setExpired(true);}}
      if(!stopped)timer=setTimeout(poll,4000);
    }
    void poll();
    const onVisible=()=>{if(document.visibilityState==="visible"){clearTimeout(timer);void poll();}};
    const onStorage=(event:StorageEvent)=>{if(event.key===storageKey){const next=readDraft(storageKey);draftRef.current=next;setDraft(next);}};
    document.addEventListener("visibilitychange",onVisible);window.addEventListener("storage",onStorage);
    return()=>{stopped=true;clearTimeout(timer);document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("storage",onStorage);};
  },[acceptView,endpoint,storageKey]);
  useEffect(()=>{
    const dialog=dialogRef.current;if(!dialog)return;
    if(modal&&!dialog.open)dialog.showModal();else if(!modal&&dialog.open)dialog.close();
    if(!modal)return;
    const old=document.body.style.overflow;document.body.style.overflow="hidden";
    return()=>{document.body.style.overflow=old;};
  },[modal]);

  async function inLock<T,>(operation:()=>Promise<T>) {
    return navigator.locks?navigator.locks.request(`qr-visit:${slug}:${token}`,operation):operation();
  }
  async function refreshMenu(coords:{latitude:number|null;longitude:number|null}) {
    const {data,error}=await createClient().rpc("get_qr_menu",{p_slug:slug,p_table_token:token,p_latitude:coords.latitude,p_longitude:coords.longitude});
    if(error||!data)throw new Error("Menyu yenilənmədi. QR kodu yenidən aç.");
    const updated=data as QRMenu;setMenu(updated);return updated;
  }
  async function ensureVisit(coords:{latitude:number|null;longitude:number|null}) {
    const result=await api(endpoint,{action:"visit",...coords});acceptView(result.view);return result.view;
  }
  async function run(label:string,operation:()=>Promise<void>) {
    if(busyRef.current)return;busyRef.current=true;setBusy(label);setMessage("");setNotice("");
    try{await inLock(operation);}catch(error){setMessage(error instanceof Error?error.message:"Bağlantı alınmadı. Yenidən cəhd et.");}
    finally{busyRef.current=false;setBusy("");}
  }
  function changeQuantity(product:{id:string;name:string;price:number},delta:number) {
    if(!canAdd)return;const current=draftRef.current,old=current.lines.find(x=>x.id===product.id),quantity=(old?.quantity||0)+delta;
    if(quantity>20||(!old&&current.lines.length>=50))return;
    const next=current.lines.filter(x=>x.id!==product.id);if(quantity>0)next.push({id:product.id,name:product.name,price:Number(product.price),quantity});
    commit({...current,lines:next});
  }
  async function locate() {
    await run("Mövqe yoxlanılır...",async()=>{
      const coords=await gps(menu.location.required),updated=await refreshMenu(coords);
      if(!["ALLOWED","NOT_REQUIRED"].includes(updated.location.status))throw new APIError("LOCATION_REQUIRED");
      await ensureVisit(coords);
    });
  }
  async function submit() {
    await run("Sifariş göndərilir...",async()=>{
      // A saved request ID survives a lost response, refresh, or another tab opening this cart.
      const savedValue=localStorage.getItem(storageKey),current=savedValue?readDraft(storageKey):draftRef.current;
      if(!current.lines.length&&!current.pending)return;
      const pending=current.pending||{id:crypto.randomUUID(),items:current.lines.map(x=>({id:x.id,quantity:x.quantity,price:Number(x.price).toFixed(2)})).sort((a,b)=>a.id.localeCompare(b.id)),currency:menu.currency,note:current.note};
      commit({...current,pending},true);
      try {
        const check=await api(endpoint);
        if(check.view?.orders.some(o=>o.request_id===pending.id)){acceptView(check.view);setModal(null);return;}
        const coords=await gps(menu.location.required);
        const active=check.view||await ensureVisit(coords);
        if(!active||active.session.status!=="OPEN")throw new APIError("TABLE_CLOSED");
        const data=await api(endpoint,{action:"order",requestId:pending.id,items:pending.items,currency:pending.currency,note:pending.note,...coords});
        acceptView(data.view);setModal(null);
      }catch(error){
        if(error instanceof APIError&&!["REQUEST_FAILED","SERVER_NOT_CONFIGURED"].includes(error.code)) {
          commit({...draftRef.current,pending:null});
          if(["PRICE_CHANGED","CURRENCY_CHANGED","PRODUCT_UNAVAILABLE"].includes(error.code)) {
            const coords=await gps(menu.location.required),updated=await refreshMenu(coords),products=updated.categories.flatMap(c=>c.products);
            const next=draftRef.current.lines.flatMap(line=>{const p=products.find(x=>x.id===line.id&&x.is_available);return p?[{...line,price:Number(p.price),name:p.name}]:[];});
            commit({...draftRef.current,lines:next});
          }
        }
        throw error;
      }
    });
  }
  async function service(kind:"WAITER"|"BILL") {
    await run(kind==="WAITER"?"Ofisiant çağırılır...":"Hesab istənilir...",async()=>{
      const coords=await gps(menu.location.required),active=await ensureVisit(coords);
      const current=draftRef.current;
      if(kind==="BILL"&&!active?.orders.some(o=>o.status!=="CANCELLED")) {
        if(current.service?.kind==="BILL")commit({...current,service:null});
        throw new APIError("NO_ORDERS");
      }
      if(kind==="BILL"&&active?.services.some(s=>s.kind==="BILL")) {
        acceptView(active);setModal(null);setNotice("Bu masa üçün hesab artıq istənilib. Seçilmiş ödəniş üsulu aşağıda görünür.");return;
      }
      if(kind==="BILL"&&current.service?.kind!=="BILL"&&!paymentMethod)throw new APIError("INVALID_PAYMENT_METHOD");
      const pending=current.service?.kind===kind?current.service:{id:crypto.randomUUID(),kind,...(kind==="BILL"&&paymentMethod?{paymentMethod}:{})};
      commit({...current,service:pending},true);
      try {
        const data=await api(endpoint,{action:"service",kind,requestId:pending.id,...(pending.paymentMethod?{paymentMethod:pending.paymentMethod}:{}),...coords});
        commit({...draftRef.current,service:null});acceptView(data.view);setModal(null);
        const chosen=data.view?.services.find(s=>s.kind==="BILL")?.payment_method;
        setNotice(kind==="WAITER"?"Ofisianta xəbər verildi.":`Masa üçün hesab istənildi.${chosen?` Ödəniş: ${paymentLabels[chosen]}.`:""} Ofisiant yaxınlaşacaq.`);
      }catch(error){if(error instanceof APIError&&!["REQUEST_FAILED","SERVER_NOT_CONFIGURED"].includes(error.code))commit({...draftRef.current,service:null});throw error;}
    });
  }
  const waiter=visit?.services.find(x=>x.kind==="WAITER"),bill=visit?.services.find(x=>x.kind==="BILL");
  const hasOwnOrder=Boolean(visit?.orders.some(o=>o.status!=="CANCELLED"));
  const filtered=menu.categories.filter(c=>category==="all"||c.id===category).map(c=>({...c,products:c.products.filter(p=>`${p.name} ${p.description||""}`.toLocaleLowerCase("az").includes(search.toLocaleLowerCase("az")))})).filter(c=>c.products.length);

  return <main className="min-h-screen bg-[#f6f5f1] pb-32 text-slate-900 selection:bg-emerald-100">
    <div className="mx-auto max-w-3xl">
      <header className="relative overflow-hidden bg-[#123f35] px-5 pb-7 pt-7 text-white sm:rounded-b-[2rem] sm:px-8">
        <div aria-hidden className="absolute -right-10 -top-16 h-56 w-56 rounded-full border-[28px] border-white/5" />
        <div className="relative flex items-start justify-between gap-4"><div>
          <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200"><UtensilsCrossed size={14}/> Rəqəmsal menyu</p>
          <h1 className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{menu.restaurant.name}</h1>
          <p className="mt-2 text-sm text-emerald-100/80">{menu.branch.name}</p>
        </div>{menu.restaurant.logo_url&&<Image unoptimized src={menu.restaurant.logo_url} width={56} height={56} alt="" className="h-14 w-14 shrink-0 rounded-2xl bg-white object-cover"/>}</div>
        <div className="relative mt-5 flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full bg-white/15 px-3 py-2 font-medium">{menu.table.name}</span><span className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2"><span className={`h-1.5 w-1.5 rounded-full ${menu.accepting_orders?"bg-emerald-300":"bg-amber-300"}`}/>{menu.accepting_orders?"Sifariş qəbulu açıqdır":"Sifariş qəbulu bağlıdır"}</span></div>
      </header>
      <div className="space-y-6 px-4 pt-5 sm:px-8">
        {!visible&&<section className="rounded-3xl border border-emerald-100 bg-white p-6 text-center shadow-sm"><div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><MapPin/></div><h2 className="text-lg font-semibold">Xoş gəlmisən</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-slate-500">Menyunu açmaq üçün restoranda olduğunu təsdiqlə və telefonunda mövqe icazəsini ver.</p>{menu.location.status==="OUTSIDE"&&<p className="mt-3 text-sm text-amber-700">Filialdan təxminən {Math.round(menu.location.distance_meters||0)} m uzaqdasan. İcazəli radius: {menu.location.allowed_radius_meters} m.</p>}<button onClick={locate} disabled={!!busy} className="mt-5 min-h-12 w-full rounded-2xl bg-emerald-700 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy||"Mövqeni təsdiqlə və menyunu aç"}</button></section>}
        {visible&&<>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={()=>void service("WAITER")} disabled={!!busy||visit?.session.status==="CLOSED"||!!waiter||!!shownDraft.service&&shownDraft.service.kind!=="WAITER"} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-medium disabled:opacity-60"><Bell size={18} className="shrink-0 text-emerald-700"/>{waiter?(waiter.status==="SEEN"?"Ofisiant gəlir":"Çağırış göndərildi"):shownDraft.service?.kind==="WAITER"?"Çağırışı yoxla":"Ofisiant çağır"}</button>
            <button onClick={()=>setModal("bill")} disabled={!hasOwnOrder||!!busy||visit?.session.status==="CLOSED"||!!bill||!!shownDraft.pending||!!shownDraft.service&&shownDraft.service.kind!=="BILL"} aria-describedby={!hasOwnOrder&&!bill&&(!visit||visit.session.status==="OPEN")?"bill-eligibility":undefined} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-3 text-sm font-medium disabled:opacity-60"><ReceiptText size={18} className="shrink-0 text-emerald-700"/>{bill?(bill.status==="SEEN"?"Hesab hazırlanır":"Hesab istənildi"):"Hesab istə"}</button>
          </div>
          {!hasOwnOrder&&!bill&&(!visit||visit.session.status==="OPEN")&&<p id="bill-eligibility" className="-mt-3 text-xs leading-5 text-slate-500">Hesab istəmək üçün əvvəl bu telefondan sifariş ver.</p>}
          {visit?.session.status==="BILL_REQUESTED"&&<p className="rounded-2xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Masa üçün hesab istənilib.{bill?.payment_method&&<strong className="block">Ödəniş: {paymentLabels[bill.payment_method]}</strong>} Əlavə sifariş vermək üçün ofisianta müraciət et.</p>}
          {(visit?.session.status==="CLOSED"||expired)&&<section className="rounded-2xl border border-stone-200 bg-white p-4"><p className="text-sm text-slate-600">{expired?"Ziyarətin müddəti bitib.":"Hesab bağlanıb. Təşəkkür edirik!"}</p><button disabled={!!busy||!!shownDraft.pending} onClick={locate} className="mt-3 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">Yeni ziyarətə başla</button></section>}
          {!menu.accepting_orders&&<p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">Filial hazırda sifariş qəbul etmir.</p>}
          <div className="relative"><Search className="absolute left-4 top-3.5 text-slate-400" size={18}/><input aria-label="Menyuda axtar" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nə yemək istəyirsən?" className="h-12 w-full rounded-2xl border border-stone-200 bg-white pl-11 pr-4 text-base outline-none focus:border-emerald-600"/></div>
          <nav aria-label="Menyu kateqoriyaları" className="sticky top-0 z-10 -mx-4 flex gap-2 overflow-x-auto bg-[#f6f5f1]/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8"><button aria-pressed={category==="all"} onClick={()=>setCategory("all")} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium ${category==="all"?"bg-emerald-800 text-white":"border border-stone-200 bg-white text-slate-600"}`}>Hamısı</button>{menu.categories.map(c=><button key={c.id} aria-pressed={category===c.id} onClick={()=>setCategory(c.id)} className={`shrink-0 rounded-full px-4 py-2.5 text-sm font-medium ${category===c.id?"bg-emerald-800 text-white":"border border-stone-200 bg-white text-slate-600"}`}>{c.name}</button>)}</nav>
          {!filtered.length&&<p className="rounded-2xl bg-white p-6 text-center text-sm text-slate-500">{search?"Axtarışa uyğun məhsul tapılmadı.":"Menyuya hələ məhsul əlavə edilməyib."}</p>}
          {filtered.map(c=><section key={c.id} className="space-y-3"><div className="mb-4"><h2 className="text-xl font-semibold tracking-tight">{c.name}</h2>{c.description&&<p className="mt-1 text-sm text-slate-500">{c.description}</p>}</div>{c.products.map(p=>{
            const quantity=lines.find(x=>x.id===p.id)?.quantity||0;
            return <article key={p.id} className={`flex gap-4 rounded-3xl border border-stone-200/80 bg-white p-4 ${!p.is_available?"opacity-60":""}`}>
              {p.image_url?<Image unoptimized src={p.image_url} width={96} height={112} alt={p.name} className="h-28 w-24 shrink-0 rounded-2xl object-cover"/>:<div aria-hidden className="flex h-28 w-24 shrink-0 items-center justify-center rounded-2xl bg-stone-50 text-stone-300"><UtensilsCrossed size={28}/></div>}
              <div className="flex min-w-0 flex-1 flex-col justify-between gap-3"><div><h3 className="break-words text-[15px] font-semibold leading-5">{p.name}</h3>{p.description&&<p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{p.description}</p>}{!p.is_available&&<p className="mt-1 text-xs text-amber-700">Hazırda mövcud deyil</p>}</div><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-semibold text-emerald-800">{money(p.price,menu.currency)}</span>{p.is_available&&(quantity?<div className="flex items-center gap-1 rounded-full bg-emerald-50"><button aria-label={`${p.name} sayını azalt`} disabled={!canAdd} onClick={()=>changeQuantity(p,-1)} className="flex h-11 w-10 items-center justify-center text-emerald-800 disabled:opacity-40"><Minus size={16}/></button><span className="min-w-4 text-center text-sm font-semibold">{quantity}</span><button aria-label={`${p.name} sayını artır`} disabled={!canAdd||quantity>=20} onClick={()=>changeQuantity(p,1)} className="flex h-11 w-10 items-center justify-center text-emerald-800 disabled:opacity-40"><Plus size={16}/></button></div>:<button aria-label={`${p.name} səbətə əlavə et`} disabled={!canAdd} onClick={()=>changeQuantity(p,1)} className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-800 text-white disabled:opacity-30"><Plus size={18}/></button>)}</div></div>
            </article>;
          })}</section>)}
        </>}
        {visit&&visit.orders.length>0&&<section id="my-orders" className="space-y-3 pb-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-xl font-semibold">Sifarişlərim</h2><span className={`flex items-center gap-1.5 text-xs ${stale?"text-amber-700":"text-emerald-700"}`}><Clock size={12}/>{stale?"Yenilənmə alınmadı":"Status avtomatik yenilənir"}</span></div>{visit.orders.map(o=><article key={o.id} className="space-y-4 rounded-3xl border border-stone-200 bg-white p-5"><div className="flex items-center justify-between gap-3"><h3 className="font-semibold">Sifariş #{o.number}</h3><span className={`rounded-full px-3 py-2 text-xs font-semibold ${o.status==="CANCELLED"?"bg-red-50 text-red-700":o.status==="SERVED"?"bg-stone-100 text-stone-600":"bg-emerald-50 text-emerald-800"}`}>{orderLabels[o.status]}</span></div>{o.status!=="CANCELLED"&&<ol aria-label="Sifarişin mərhələləri" className="grid grid-cols-5 gap-1.5">{orderSteps.map((step,index)=><li key={step} className="text-center"><div className={`mb-2 h-1 rounded-full ${index<=orderSteps.indexOf(o.status)?"bg-emerald-700":"bg-stone-100"}`}/><span className={`block text-[10px] leading-4 ${index<=orderSteps.indexOf(o.status)?"text-emerald-800":"text-slate-400"}`}>{orderLabels[step]}</span></li>)}</ol>}<div className="space-y-2 text-sm">{o.items.map((x,index)=><div key={index} className="flex justify-between gap-3"><span className="break-words text-slate-600">{x.quantity} × {x.name}</span><span className="shrink-0 font-medium">{money(x.total,o.currency)}</span></div>)}</div>{o.note&&<p className="rounded-xl bg-stone-50 p-3 text-xs text-slate-600">Qeyd: {o.note}</p>}<div className="flex justify-between border-t border-stone-100 pt-3 text-sm font-semibold"><span>Cəmi</span><span>{money(o.total,o.currency)}</span></div></article>)}</section>}
        {message&&<p role="alert" className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm leading-6 text-red-800">{message}</p>}
        {notice&&<p role="status" className="flex items-start gap-2 rounded-2xl bg-emerald-50 p-4 text-sm leading-6 text-emerald-900"><Check size={18} className="mt-1 shrink-0"/>{notice}</p>}
        <footer className="pb-5 text-center text-xs leading-6 text-slate-400">{menu.branch.address}<br/>{menu.restaurant.name} · {menu.table.name}</footer>
      </div>
    </div>
    {visible&&count>0&&<div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur"><button onClick={()=>setModal("cart")} className="mx-auto flex min-h-14 w-full max-w-[704px] items-center justify-between gap-3 rounded-2xl bg-emerald-800 px-5 py-3 text-white shadow-lg shadow-emerald-900/10"><span className="flex min-w-0 flex-1 items-center gap-3 text-sm font-semibold"><ShoppingBag size={20}/><span className="rounded-lg bg-white/15 px-2 py-1">{count}</span><span className="truncate">{shownDraft.pending?"Göndərilməni yoxla":"Səbətə bax"}</span></span><span className="flex shrink-0 items-center gap-2 text-sm font-semibold">{money(total,menu.currency)}<ChevronRight size={16}/></span></button></div>}
    <dialog ref={dialogRef} onCancel={()=>setModal(null)} onClose={()=>setModal(null)} aria-labelledby="qr-dialog-title" className="fixed inset-x-0 bottom-0 top-auto m-0 max-h-[90dvh] w-full max-w-none overflow-y-auto rounded-t-3xl bg-white p-5 text-slate-900 shadow-xl backdrop:bg-slate-950/40 sm:inset-0 sm:m-auto sm:max-h-[85dvh] sm:max-w-lg sm:rounded-3xl sm:p-6">
      <div className="mb-5 flex items-center justify-between"><h2 id="qr-dialog-title" className="text-xl font-semibold">{modal==="bill"?"Masa üçün hesab istə":"Səbətim"}</h2><button onClick={()=>setModal(null)} aria-label="Pəncərəni bağla" className="flex h-11 w-11 items-center justify-center rounded-full bg-stone-100"><X size={20}/></button></div>
      {modal==="bill"?<><p className="text-sm leading-6 text-slate-600">{hasOwnOrder?"Masanın bütün sifarişləri üçün hesab istəniləcək. Əlavə sifariş qəbulu dayanacaq. Ofisiant hesabı gətirəcək.":orderError("NO_ORDERS")}</p><fieldset disabled={!!busy||!!shownDraft.service} className="mt-5 space-y-2"><legend className="mb-3 text-sm font-semibold">Necə ödəyəcəksən?</legend>{(Object.keys(paymentLabels) as PaymentMethod[]).map(method=><label key={method} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm ${((shownDraft.service?.paymentMethod||paymentMethod)===method)?"border-emerald-700 bg-emerald-50":"border-stone-200"}`}><input type="radio" name="bill-payment" value={method} checked={(shownDraft.service?.paymentMethod||paymentMethod)===method} onChange={()=>setPaymentMethod(method)} className="h-4 w-4 accent-emerald-800"/>{paymentLabels[method]}</label>)}</fieldset><p className="mt-3 text-xs leading-5 text-slate-500">Seçim ofisianta göndərilir. Ödənişi restoranda edəcəksən.</p>{shownDraft.service?.kind==="BILL"&&<p className="mt-3 text-xs leading-5 text-amber-800">Göndərilmə nəticəsini yenidən yoxlayırıq; seçimin dəyişməyəcək.</p>}<button disabled={!!busy||!hasOwnOrder||!!bill||visit?.session.status==="CLOSED"||!paymentMethod&&!shownDraft.service} onClick={()=>void service("BILL")} className="mt-6 min-h-12 w-full rounded-2xl bg-emerald-800 p-4 text-sm font-semibold text-white disabled:opacity-50">{busy||"Hesabı istə"}</button></>:<>
        {lines.map(line=><div key={line.id} className="flex items-center justify-between gap-3 border-b border-stone-100 py-3"><div className="min-w-0"><h3 className="break-words text-sm font-medium">{line.name}</h3><p className="mt-1 text-xs text-slate-500">{money(line.price,menu.currency)}</p></div><div className="flex shrink-0 items-center gap-2"><button aria-label={`${line.name} sayını azalt`} disabled={!!busy||locked} onClick={()=>changeQuantity(line,-1)} className="flex h-11 w-10 items-center justify-center rounded-xl bg-stone-100 disabled:opacity-40"><Minus size={16}/></button><span className="min-w-4 text-center text-sm">{line.quantity}</span><button aria-label={`${line.name} sayını artır`} disabled={!!busy||locked||line.quantity>=20} onClick={()=>changeQuantity(line,1)} className="flex h-11 w-10 items-center justify-center rounded-xl bg-stone-100 disabled:opacity-40"><Plus size={16}/></button></div></div>)}
        {!lines.length&&<p className="text-sm text-slate-500">Səbətin boşdur.</p>}
        <label className="mt-5 block text-sm font-medium">Sifariş üçün qeyd<textarea value={hydrated?draft.note:""} disabled={!!busy||locked} maxLength={500} onChange={e=>commit({...draftRef.current,note:e.target.value})} placeholder="Məsələn: soğansız olsun" rows={2} className="mt-2 w-full resize-none rounded-2xl border border-stone-200 p-3 text-base font-normal outline-none focus:border-emerald-600 disabled:opacity-60"/></label>
        <div className="my-5 flex justify-between font-semibold"><span>Cəmi</span><span>{money(total,menu.currency)}</span></div>
        {shownDraft.pending&&<p className="mb-4 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">Göndərilmə nəticəsini yoxlayırıq. Yenidən yoxlama eyni sorğunu davam etdirir və əlavə sifariş yaratmır.</p>}
        <button disabled={!!busy||!lines.length||visit?.session.status==="BILL_REQUESTED"||visit?.session.status==="CLOSED"} onClick={()=>void submit()} className="min-h-14 w-full rounded-2xl bg-emerald-800 px-4 py-4 text-sm font-semibold text-white disabled:opacity-40">{busy|| (shownDraft.pending?"Göndərilməni yenidən yoxla":"Sifarişi göndər")}</button><p className="mt-3 text-center text-xs leading-5 text-slate-400">Bu telefondakı səbət ayrıca sifariş kimi göndərilir.</p>
      </>}
      {message&&<p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">{message}</p>}
    </dialog>
  </main>;
}
