"use client";
import {useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {ownerMoney} from "@/lib/owner-dashboard";
import {amount,cents,operationsError,readManualPending,savePending,type ManualMenu,type ManualLine,type ManualAttempt,type ManualReceipt} from "@/lib/restaurant-operations";

export default function ManualOrder({restaurantId,branchId,onClose,onSuccess}:{restaurantId:string;branchId:string;onClose:()=>void;onSuccess:(receipt:ManualReceipt)=>void}){
  const key=`qr-manual-${restaurantId}-${branchId}`;
  const [attempt,setAttempt]=useState<ManualAttempt|null>(()=>readManualPending(key)),pending=useRef<ManualAttempt|null>(attempt);
  const [menu,setMenu]=useState<ManualMenu|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [table,setTable]=useState(attempt?.table||""),[cart,setCart]=useState<ManualLine[]>(attempt?.items||[]),[note,setNote]=useState(attempt?.note||""),[search,setSearch]=useState("");
  const action=useRef(false),alive=useRef(true),shell=useRef<HTMLDialogElement>(null);
  useEffect(()=>{const d=shell.current;d?.showModal();return()=>d?.close();},[]);
  async function reload(){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{
    const result=await createClient().rpc("qr_manual_menu",{p_restaurant_id:restaurantId,p_branch_id:branchId}).abortSignal(controller.signal);
    if(!alive.current)return;if(result.error||!result.data){setError(operationsError(result.error?.code==="42501"?"FORBIDDEN":result.error?.message));return;}
    const data=result.data as ManualMenu;setMenu(data);
    if(!pending.current)setCart(lines=>lines.map(line=>({...line,price:data.products.find(p=>p.id===line.id)?.price||line.price})));
  }catch{if(alive.current)setError("Menyu yüklənmədi. Yenidən yoxla.");}finally{clearTimeout(timer);if(alive.current)setLoading(false);}}
  useEffect(()=>{alive.current=true;const initialLoad=setTimeout(()=>void reload(),0);return()=>{alive.current=false;clearTimeout(initialLoad);};},[]); // eslint-disable-line react-hooks/exhaustive-deps
  async function submit(){if(action.current||!menu)return;const selected=menu.tables.find(t=>t.id===table);if(!pending.current&&(!selected||!cart.length))return;
    const input=pending.current||{table,session:selected!.session_id,request:crypto.randomUUID(),items:cart.map(x=>({...x})),currency:menu.currency,note:note.trim()};
    pending.current=input;setAttempt(input);savePending(key,input);action.current=true;setBusy(true);setError("");
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{const result=await createClient().rpc("qr_manual_submit",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_table_id:input.table,p_session_id:input.session,p_request_id:input.request,p_items:input.items,p_currency:input.currency,p_note:input.note||null}).abortSignal(controller.signal);
      if(!alive.current)return;
      if(result.error){if(result.error.code==="P0001"||result.error.code==="42501"||result.error.code==="22023"){
        pending.current=null;setAttempt(null);savePending(key,null);setError(operationsError(result.error.code==="42501"?"FORBIDDEN":result.error.message));setLoading(true);await reload();
      }else setError("Cavab alınmadı. Eyni sifarişi yenidən yoxla; təkrar sifariş yaranmayacaq.");return;}
      if(!result.data){setError("Cavab alınmadı. Eyni sifarişi yenidən yoxla.");return;}
      pending.current=null;savePending(key,null);onSuccess(result.data as ManualReceipt);
    }catch{if(alive.current)setError("Bağlantı alınmadı. Eyni sifarişi yenidən yoxla; təkrar sifariş yaranmayacaq.");}
    finally{clearTimeout(timer);action.current=false;if(alive.current)setBusy(false);}
  }
  function change(id:string,delta:number){if(attempt||busy)return;const p=menu?.products.find(x=>x.id===id);if(!p)return;setCart(lines=>{const old=lines.find(x=>x.id===id),quantity=(old?.quantity||0)+delta;if(quantity<1)return lines.filter(x=>x.id!==id);if(quantity>20||!old&&lines.length>=50)return lines;return old?lines.map(x=>x.id===id?{...x,quantity}:x):[...lines,{id,quantity,price:p.price}];});}
  const selected=menu?.tables.find(t=>t.id===table),locked=busy||Boolean(attempt),needle=search.toLocaleLowerCase("az"),products=menu?.products.filter(p=>`${p.name} ${p.category}`.toLocaleLowerCase("az").includes(needle))||[];
  const invalid=cart.some(line=>!menu?.products.some(p=>p.id===line.id&&p.available));
  const total=cart.reduce((sum,line)=>sum+cents(line.price)*BigInt(line.quantity),BigInt(0));
  return <dialog ref={shell} aria-labelledby="manual-title" onCancel={event=>{if(busy)event.preventDefault();else onClose();}} className="m-auto w-[calc(100%_-_1rem)] max-w-5xl overflow-hidden rounded-2xl bg-transparent p-0 backdrop:bg-slate-950/40"><section className="flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl">
    <div className="flex items-center justify-between gap-3 border-b p-4"><h2 id="manual-title" className="text-lg font-bold">Masa üçün sifariş</h2><button disabled={busy} onClick={onClose} className="min-h-11 rounded-xl border px-4 text-sm disabled:opacity-50">Bağla</button></div>
    <div className="overflow-y-auto p-4 sm:p-6">
      {error&&<p role="alert" className="mb-4 rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">{error}</p>}
      {attempt&&<p className="mb-4 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">Göndərilmiş sifariş yoxlanılır. Səbət saxlanılıb; eyni sifarişi təkrar yoxlamaq əlavə sifariş yaratmır.</p>}
      {loading?<p className="py-8 text-center">Menyu yüklənir...</p>:!menu?<button onClick={()=>{setLoading(true);void reload();}} className="min-h-12 rounded-xl border px-4">Yenidən yoxla</button>:<>
        {!menu.accepting_orders&&!attempt&&<p className="mb-3 text-sm text-red-700">Filialda sifariş qəbulu bağlıdır.</p>}
        <label className="mb-5 block space-y-2 font-medium"><span>Masa</span><select aria-label="Sifariş masası" value={table} disabled={locked} onChange={e=>setTable(e.target.value)} className="min-h-12 w-full rounded-xl border px-3 text-base"><option value="">Masanı seç</option>{menu.tables.map(t=><option key={t.id} value={t.id} disabled={t.status==="BILL_REQUESTED"}>{t.name}{t.status==="BILL_REQUESTED"?" · Hesab istənilib":t.status==="OPEN"?" · Açıq hesab":""}</option>)}</select></label>
        <div className="grid items-start gap-5 md:grid-cols-2"><div><input aria-label="Məhsul axtar" placeholder="Məhsul və ya kateqoriya axtar" value={search} onChange={e=>setSearch(e.target.value)} className="mb-3 min-h-12 w-full rounded-xl border px-3 text-base"/><div className="max-h-80 space-y-2 overflow-y-auto">{products.map(p=><article key={p.id} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border p-3"><div className="min-w-0"><p className="break-words font-semibold">{p.name}</p><p className="text-xs text-slate-500">{p.category}</p><p className="mt-1 text-sm">{ownerMoney(p.price,menu.currency)}{!p.available&&" · Mövcud deyil"}</p></div><button aria-label={`${p.name} əlavə et`} disabled={locked||!p.available} onClick={()=>change(p.id,1)} className="min-h-11 shrink-0 rounded-xl bg-emerald-800 px-4 text-white disabled:opacity-40">+</button></article>)}{!products.length&&<p className="py-4 text-sm text-slate-500">Məhsul tapılmadı.</p>}</div></div>
          <div className="space-y-3"><h3 className="font-bold">Səbət</h3>{!cart.length&&<p className="text-sm text-slate-500">Sifarişə məhsul əlavə et.</p>}{cart.map(line=>{const p=menu.products.find(x=>x.id===line.id);return <article key={line.id} className="min-w-0 rounded-xl bg-slate-50 p-3"><p className="break-words font-semibold">{p?.name||"Menyudan çıxarılmış məhsul"}</p>{(!p||!p.available)&&<p className="text-xs text-red-700">Mövcud deyil; səbətdən çıxar.</p>}<div className="mt-2 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-3"><button aria-label={`${p?.name||"Məhsul"} sayını azalt`} disabled={locked} onClick={()=>{if(!p)setCart(lines=>lines.filter(x=>x.id!==line.id));else change(line.id,-1);}} className="min-h-11 min-w-11 rounded-xl border">−</button><span>{line.quantity}</span><button aria-label={`${p?.name||"Məhsul"} sayını artır`} disabled={locked||!p?.available||line.quantity>=20} onClick={()=>change(line.id,1)} className="min-h-11 min-w-11 rounded-xl border">+</button></div><span className="text-sm font-semibold">{ownerMoney(amount(cents(line.price)*BigInt(line.quantity)),menu.currency)}</span></div></article>;})}
            <label className="block space-y-2 text-sm"><span>Mətbəx üçün qeyd</span><textarea value={note} disabled={locked} maxLength={500} onChange={e=>setNote(e.target.value)} className="min-h-20 w-full rounded-xl border p-3 text-base"/></label>
          </div></div>
      </>}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t bg-white p-4"><p className="font-bold">Cəmi: {ownerMoney(amount(total),attempt?.currency||menu?.currency||"AZN")}</p><button disabled={busy||loading||!menu||!cart.length||!attempt&&(!selected||(!menu.accepting_orders||selected?.status==="BILL_REQUESTED"||invalid))} onClick={()=>void submit()} className="min-h-12 rounded-xl bg-emerald-800 px-5 font-semibold text-white disabled:opacity-40">{busy?"Göndərilir...":attempt?"Eyni sifarişi yenidən yoxla":"Mətbəxə göndər"}</button></div>
  </section></dialog>;
}
