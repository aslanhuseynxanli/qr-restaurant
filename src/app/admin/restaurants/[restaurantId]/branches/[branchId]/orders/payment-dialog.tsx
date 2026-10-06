"use client";
import {useEffect,useRef,useState} from "react";
import {paymentLabels,type PaymentMethod,type StaffSession} from "@/lib/qr-orders";
import {amountCents,centsAmount,exactMoney,type SettlementFeedback,type SettlementInput} from "@/lib/account-payments";

const field="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-3 text-base disabled:opacity-50";
export default function PaymentDialog({session,onClose,onSettle}:{session:StaffSession;onClose:()=>void;onSettle:(input:SettlementInput)=>Promise<SettlementFeedback>}) {
  const dialog=useRef<HTMLDialogElement>(null),submitted=useRef<SettlementInput|null>(null),sending=useRef(false);
  const [method,setMethod]=useState<PaymentMethod>(session.services.find(c=>c.kind==="BILL")?.payment_method||"CASH");
  const [cash,setCash]=useState(""),[card,setCard]=useState(""),[pending,setPending]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState("");
  const total=session.payment_total||Number(session.total).toFixed(2),totalCents=amountCents(total);
  const cashCents=amountCents(cash),cardCents=amountCents(card);
  const sum=cashCents!==null&&cardCents!==null?cashCents+cardCents:null;
  const valid=totalCents!==null&&(method!=="MIXED"||sum===totalCents&&cashCents! > BigInt(0)&&cardCents! > BigInt(0));
  const locked=pending||uncertain;
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>{el?.close();};},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();if(sending.current||!valid&&!uncertain)return;
    if(!uncertain||!submitted.current){
      if(totalCents===null)return;
      submitted.current={session_id:session.id,version:session.version,request_id:crypto.randomUUID(),method,
        cash:method==="CARD"?"0.00":method==="CASH"?centsAmount(totalCents):centsAmount(cashCents!),
        card:method==="CASH"?"0.00":method==="CARD"?centsAmount(totalCents):centsAmount(cardCents!),total:centsAmount(totalCents),currency:session.currency};
    }
    sending.current=true;setPending(true);setError("");
    try{
      const result=await onSettle(submitted.current);
      if(result.ok){onClose();return;}
      setError(result.error||"Ödəniş təsdiqlənmədi.");setUncertain(Boolean(result.retry));
      if(!result.retry)submitted.current=null;
    }catch{setError("Cavab alınmadı. Eyni ödənişi yenidən yoxla; təkrar ödəniş qeydi yaranmayacaq.");setUncertain(true);}
    finally{sending.current=false;setPending(false);}
  }
  return <dialog ref={dialog} aria-labelledby="payment-title" onCancel={event=>{if(pending)event.preventDefault();else onClose();}}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-lg overflow-y-auto rounded-3xl bg-white p-0 text-slate-900 shadow-2xl backdrop:bg-slate-900/60">
    <form onSubmit={event=>void submit(event)} className="space-y-5 p-5 sm:p-7" aria-busy={pending}>
      <header><h2 id="payment-title" className="text-xl font-bold">Ödənişi təsdiqlə</h2><p className="mt-2 break-words text-sm text-slate-500">{session.table_name} · Bütün masanın hesabı</p></header>
      <div className="rounded-2xl bg-emerald-50 p-4"><p className="text-sm text-emerald-800">Alınmalı məbləğ</p><p className="mt-2 break-words text-2xl font-bold text-emerald-900">{exactMoney(total,session.currency)}</p></div>
      <p className="text-sm leading-6 text-slate-600">Müştəridən faktiki aldığın ödənişi qeyd et. Təsdiqləyəndə masa bağlanacaq.</p>
      <fieldset disabled={locked}><legend className="mb-2 text-sm font-semibold">Alınmış ödəniş üsulu</legend><div className="grid grid-cols-3 gap-2">{(["CASH","CARD","MIXED"] as PaymentMethod[]).map(value=><label key={value} className={`flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border px-2 py-3 text-center text-sm ${method===value?"border-emerald-800 bg-emerald-50 font-semibold text-emerald-900":"border-slate-200"}`}><input type="radio" name="payment-method" value={value} checked={method===value} onChange={()=>{setMethod(value);setError("");}} className="accent-emerald-800"/><span>{paymentLabels[value]}</span></label>)}</div></fieldset>
      {method==="MIXED"&&<div className="space-y-3"><div className="grid grid-cols-2 gap-3"><label className="min-w-0 space-y-2 text-sm font-medium"><span>Nağd məbləğ</span><input aria-label="Nağd məbləğ" inputMode="decimal" autoComplete="off" required value={cash} disabled={locked} onChange={e=>setCash(e.target.value)} placeholder="0.00" maxLength={19} className={field}/></label><label className="min-w-0 space-y-2 text-sm font-medium"><span>Kart məbləği</span><input aria-label="Kart məbləği" inputMode="decimal" autoComplete="off" required value={card} disabled={locked} onChange={e=>setCard(e.target.value)} placeholder="0.00" maxLength={19} className={field}/></label></div>
        <p aria-live="polite" className={`text-sm leading-6 ${valid?"text-emerald-800":"text-amber-800"}`}>{valid?"Məbləğlərin cəmi hesabla uyğundur.":sum!==null&&totalCents!==null&&sum!==totalCents?`${exactMoney(centsAmount(sum>totalCents?sum-totalCents:totalCents-sum),session.currency)} ${sum>totalCents?"artıq yazılıb.":"çatışmır."}`:"Hər iki məbləği yaz. Cəmi hesabla eyni olmalıdır."}</p></div>}
      {error&&<p role="alert" className="rounded-xl bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
      {uncertain&&<p className="text-sm leading-6 text-slate-600">Nəticə dəqiqləşənədək daxil etdiyin məbləğlər saxlanılır. Düymə eyni təsdiqi yenidən yoxlayır.</p>}
      <div className="flex flex-col gap-2"><button disabled={pending||!valid&&!uncertain} className="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{pending?"Yoxlanılır...":uncertain?"Eyni ödənişi yenidən yoxla":"Ödəniş alındı · Masanı bağla"}</button><button type="button" disabled={pending} onClick={onClose} className="min-h-12 rounded-xl border border-slate-200 px-4 py-3 text-sm font-medium disabled:opacity-40">Geri qayıt</button></div>
    </form>
  </dialog>;
}
