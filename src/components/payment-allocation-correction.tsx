"use client";
import {useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {exactMoney} from "@/lib/account-payments";
import {formatOwnerTime} from "@/lib/owner-dashboard";
import {paymentLabels,type PaymentMethod} from "@/lib/qr-orders";
import {allocationAmounts,allocationError,allocationKey,allocationMethod,readAllocationAttempt,type AllocationAttempt,type AllocationBoard} from "@/lib/payment-corrections";

export default function PaymentAllocationCorrection({restaurantId,sessionId,disabled=false,onUpdated}:{restaurantId:string;sessionId:string;disabled?:boolean;onUpdated?:()=>void}){
 const [open,setOpen]=useState(false);
 return <><button type="button" disabled={disabled} onClick={()=>setOpen(true)} className="portal-btn">Ödəniş bölgüsünü düzəlt</button>{open&&<CorrectionDialog restaurantId={restaurantId} sessionId={sessionId} onClose={()=>setOpen(false)} onUpdated={onUpdated}/>}</>;
}
function CorrectionDialog({restaurantId,sessionId,onClose,onUpdated}:{restaurantId:string;sessionId:string;onClose:()=>void;onUpdated?:()=>void}){
 const dialog=useRef<HTMLDialogElement>(null),controller=useRef<AbortController|null>(null),alive=useRef(true),sending=useRef(false);
 const [board,setBoard]=useState<AllocationBoard|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[notice,setNotice]=useState(""),[preferredPart,setPreferredPart]=useState<string|null|undefined>(undefined);
 async function read(){setLoading(true);setError("");const request=new AbortController(),timer=setTimeout(()=>request.abort(),15000);controller.current=request;
  try{const r=await createClient().rpc("owner_payment_allocations",{p_restaurant_id:restaurantId,p_session_id:sessionId}).abortSignal(request.signal);if(!alive.current)return;if(r.error||!r.data){setBoard(null);setError(r.error?.code==="42501"?allocationError("FORBIDDEN"):"Ödəniş məlumatları yüklənmədi. Yenidən yoxla.");}else setBoard(r.data as AllocationBoard);}
  catch{if(alive.current)setError("Bağlantı alınmadı. Yenidən yoxla.");}
  finally{clearTimeout(timer);if(alive.current)setLoading(false);}
 }
 useEffect(()=>{alive.current=true;const d=dialog.current;d?.showModal();const initialLoad=setTimeout(()=>void read(),0);return()=>{clearTimeout(initialLoad);alive.current=false;controller.current?.abort();d?.close();};},[]); // eslint-disable-line react-hooks/exhaustive-deps
 return <dialog ref={dialog} aria-labelledby="allocation-title" onCancel={e=>{if(sending.current)e.preventDefault();else onClose();}} className="portal-operation-dialog m-auto max-h-[90dvh] overflow-y-auto rounded-3xl bg-white text-slate-900 shadow-2xl backdrop:bg-slate-900/60"><div className="space-y-5"><header className="portal-operation-heading"><h2 id="allocation-title" className="text-xl font-bold">Ödəniş bölgüsünü düzəlt</h2>{board&&<p className="portal-help mt-2">{board.table_name} · {board.status==="CLOSED"?"Bağlanmış hesab":"Alınmış ödəniş hissələri"}</p>}</header>
 {notice&&<p role="status" className="portal-notice">{notice}</p>}{error&&<p role="alert" className="portal-notice portal-notice-error">{error}</p>}
 {loading?<p role="status" className="portal-help">Ödəniş məlumatları yüklənir…</p>:board?<CorrectionForm key={`${board.user_id}:${board.version}`} restaurantId={restaurantId} board={board} preferredPart={preferredPart} onBusy={value=>{sending.current=value;}} onClose={onClose} onReload={()=>{setNotice("");void read();}} onSuccess={(data,part)=>{setPreferredPart(part);setBoard(data);setNotice("Kart/nağd bölgüsü düzəldildi. Səbəb və əvvəlki bölgü tarixçədə saxlanıldı.");onUpdated?.();}}/>:<div className="flex flex-wrap gap-2"><button type="button" onClick={()=>void read()} className="portal-btn portal-btn-primary">Yenidən yoxla</button><button type="button" onClick={onClose} className="portal-btn">Geri qayıt</button></div>}
 </div></dialog>;
}
function CorrectionForm({restaurantId,board,preferredPart,onBusy,onClose,onReload,onSuccess}:{restaurantId:string;board:AllocationBoard;preferredPart:string|null|undefined;onBusy:(value:boolean)=>void;onClose:()=>void;onReload:()=>void;onSuccess:(board:AllocationBoard,part:string|null)=>void}){
 const sending=useRef(false),preferred=board.parts.find(p=>p.id===preferredPart)||board.parts[0];
 const key=allocationKey(board.user_id,restaurantId,board.session_id),[saved]=useState(()=>readAllocationAttempt(key)),attempt=useRef<AllocationAttempt|null>(saved);
 const [selection,setSelection]=useState(saved?.part||preferred?.id||""),[method,setMethod]=useState<PaymentMethod>(()=>saved?allocationMethod(saved):preferred?allocationMethod(preferred):"CASH");
 const [cash,setCash]=useState(saved?.cash||preferred?.cash||""),[card,setCard]=useState(saved?.card||preferred?.card||""),[reason,setReason]=useState(saved?.reason||"");
 const [busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(Boolean(saved)),[displayAttempt,setDisplayAttempt]=useState<AllocationAttempt|null>(saved),[error,setError]=useState("");const alive=useRef(true),request=useRef<AbortController|null>(null);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;request.current?.abort();};},[]);
 const selected=board.parts.find(p=>(p.id||"")===selection),locked=busy||uncertain,amounts=selected?allocationAmounts(selected.total,method,cash,card):null;
 function choose(id:string){const p=board.parts.find(p=>(p.id||"")===id);if(!p)return;setSelection(id);setMethod(allocationMethod(p));setCash(p.cash);setCard(p.card);setError("");}
 async function submit(e:React.FormEvent){e.preventDefault();if(sending.current)return;let input=attempt.current;
  if(!input){if(!selected||!amounts||reason.trim().length<3){setError(allocationError(!amounts?"CORRECTION_TOTAL_CHANGED":"INVALID_CORRECTION"));return;}if(amounts.cash===selected.cash&&amounts.card===selected.card){setError(allocationError("NO_CHANGES"));return;}
   input={request:crypto.randomUUID(),version:board.version,part:selected.id,cash:amounts.cash,card:amounts.card,reason:reason.trim(),label:selected.label||"Ödəniş hissəsi",old_cash:selected.cash,old_card:selected.card,currency:board.currency};
   try{sessionStorage.setItem(key,JSON.stringify(input));}catch{setError("Düzəlişi yadda saxlamaq mümkün olmadı. Adi brauzer pəncərəsində yenidən yoxla.");return;}attempt.current=input;setDisplayAttempt(input);
  }
  sending.current=true;onBusy(true);setBusy(true);setError("");const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);request.current=abort;
  let updated:AllocationBoard|null=null;
  try{const r=await createClient().rpc("owner_correct_payment_allocation",{p_restaurant_id:restaurantId,p_session_id:board.session_id,p_part_id:input.part,p_version:input.version,p_request_id:input.request,p_cash:input.cash,p_card:input.card,p_reason:input.reason}).abortSignal(abort.signal);
   if(!alive.current)return;
   if(r.error){if(["P0001","42501","22023"].includes(r.error.code||"")){attempt.current=null;setDisplayAttempt(null);try{sessionStorage.removeItem(key);}catch{}setUncertain(false);setError(allocationError(r.error.code==="42501"?"FORBIDDEN":r.error.message));return;}throw new Error();}
   if(!r.data)throw new Error();updated=r.data as AllocationBoard;attempt.current=null;setDisplayAttempt(null);try{sessionStorage.removeItem(key);}catch{}setUncertain(false);
  }catch{if(alive.current){setUncertain(true);setError("Cavab alınmadı. Eyni düzəlişi yenidən yoxla. Sorğu saxlanılıb; ikinci dəyişiklik qeydi yaranmayacaq.");}}
  finally{clearTimeout(timer);sending.current=false;onBusy(false);if(alive.current)setBusy(false);}
  if(updated&&alive.current)onSuccess(updated,input.part);
 }
 return <><p className="portal-help">Alınmış ödənişin kart/nağd qeydini düzəlt. Seçilmiş ödənişin məbləği və hesabın yekunu sabit qalır.</p>
 {board.can_correct&&board.parts.length>0?<form onSubmit={e=>void submit(e)} className="space-y-4" aria-busy={busy}>
 {uncertain&&displayAttempt&&<div className="portal-notice portal-notice-warning"><p className="font-semibold">Göndərilmiş düzəlişi yoxla</p><p className="mt-2">{displayAttempt.label} · Nağd {exactMoney(displayAttempt.cash,displayAttempt.currency)} · Kart {exactMoney(displayAttempt.card,displayAttempt.currency)}</p><p className="mt-1">Səbəb: {displayAttempt.reason}</p></div>}
 <fieldset disabled={locked} className="space-y-4">
 {board.parts.length>1&&<label className="portal-field"><span>Düzəldiləcək ödəniş hissəsi</span><select aria-label="Düzəldiləcək ödəniş hissəsi" value={selection} onChange={e=>choose(e.target.value)} className="portal-input">{board.parts.map((p,i)=><option key={p.id||"full"} value={p.id||""}>{p.label||`Hissə ${i+1}`} · {exactMoney(p.total,board.currency)}</option>)}</select></label>}
 {selected&&<div className="rounded-xl bg-slate-50 p-4 text-sm"><p className="font-bold">Ödəniş: {exactMoney(selected.total,board.currency)}</p><p className="mt-2 text-slate-600">Hazırkı qeyd: Nağd {exactMoney(selected.cash,board.currency)} · Kart {exactMoney(selected.card,board.currency)}</p></div>}
 <label className="portal-field"><span>Düzgün ödəniş üsulu</span><select aria-label="Düzgün ödəniş üsulu" value={method} onChange={e=>setMethod(e.target.value as PaymentMethod)} className="portal-input">{Object.entries(paymentLabels).map(([id,title])=><option key={id} value={id}>{title}</option>)}</select></label>
 {method==="MIXED"&&<div className="grid grid-cols-2 gap-3"><label className="portal-field"><span>Nağd ({board.currency})</span><input aria-label="Düzəlişin nağd məbləği" inputMode="decimal" maxLength={19} value={cash} onChange={e=>setCash(e.target.value)} className="portal-input"/></label><label className="portal-field"><span>Kart ({board.currency})</span><input aria-label="Düzəlişin kart məbləği" inputMode="decimal" maxLength={19} value={card} onChange={e=>setCard(e.target.value)} className="portal-input"/></label></div>}
 {amounts&&<p className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">Yeni bölgü: Nağd {exactMoney(amounts.cash,board.currency)} · Kart {exactMoney(amounts.card,board.currency)}</p>}
 <label className="portal-field"><span>Düzəliş səbəbi</span><textarea aria-label="Düzəliş səbəbi" required minLength={3} maxLength={500} rows={3} value={reason} onChange={e=>setReason(e.target.value)} className="portal-input"/></label>
 </fieldset>{error&&<p role="alert" className="portal-notice portal-notice-error">{error}</p>}
 <div className="flex flex-wrap gap-2"><button disabled={busy||!uncertain&&!amounts} className="portal-btn portal-btn-primary">{busy?"Yoxlanılır…":uncertain?"Eyni düzəlişi yenidən yoxla":"Düzəlişi yadda saxla"}</button><button type="button" disabled={busy||uncertain} onClick={onReload} className="portal-btn">Cari məlumatları yenilə</button><button type="button" disabled={busy} onClick={onClose} className="portal-btn">Geri qayıt</button></div>
 </form>:<><p className="portal-notice">{!board.can_correct?allocationError("FORBIDDEN"):"Bu hesabda qeydə alınmış ödəniş yoxdur."}</p><button type="button" onClick={onClose} className="portal-btn">Geri qayıt</button></>}
 {board.changes.length>0&&<section aria-label="Ödəniş düzəlişlərinin tarixçəsi" className="space-y-3 border-t border-slate-200 pt-4"><h3 className="font-bold">Düzəliş tarixçəsi ({board.change_count})</h3>{board.changes.map(c=><article key={c.id} className="space-y-2 rounded-xl bg-slate-50 p-3 text-sm"><p className="font-semibold">{c.label} · {c.actor_name}</p><p>Əvvəl: Nağd {exactMoney(c.old_cash,board.currency)} · Kart {exactMoney(c.old_card,board.currency)}</p><p>Sonra: Nağd {exactMoney(c.cash,board.currency)} · Kart {exactMoney(c.card,board.currency)}</p><p className="break-words">Səbəb: {c.reason}</p><p className="portal-help">{formatOwnerTime(c.at)}</p></article>)}{Number(board.change_count)>board.changes.length&&<p className="portal-help">Son {board.changes.length} düzəliş göstərilir. Bütün qeydlər saxlanılır.</p>}</section>}
 </>;
}
