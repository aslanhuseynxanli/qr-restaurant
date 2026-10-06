"use client";

import { useCallback,useEffect,useRef,useState } from "react";
import { Volume2,VolumeX } from "lucide-react";
import type { StaffBoard } from "@/lib/qr-orders";

export default function OrderSound({board}:{board:StaffBoard}) {
  const context=useRef<AudioContext|null>(null);
  const enabled=useRef(false);
  const known=useRef(new Set(board.sessions.flatMap(s=>s.orders.map(o=>o.id))));
  const [active,setActive]=useState(false),[error,setError]=useState("");
  const allowed=board.sound_enabled!==false;
  const ring=useCallback(async()=>{
    const audio=context.current;
    if(!audio||!enabled.current)return;
    if(audio.state!=="running")throw new Error("Səs dayandırılıb. Yenidən aktiv et.");
    [740,980].forEach((frequency,index)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain(),start=audio.currentTime+index*0.18;
      oscillator.type="sine";oscillator.frequency.setValueAtTime(frequency,start);
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(0.13,start+0.015);gain.gain.exponentialRampToValueAtTime(0.001,start+0.3);
      oscillator.connect(gain);gain.connect(audio.destination);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(start);oscillator.stop(start+0.32);
    });
  },[]);
  useEffect(()=>{
    const orders=board.sessions.flatMap(s=>s.orders);
    const incoming=orders.some(o=>o.status==="NEW"&&!known.current.has(o.id));
    // Keep the previous snapshot as well: stale poll responses cannot ring a second time.
    for(const order of orders)known.current.add(order.id);
    if(known.current.size>10000)known.current=new Set(orders.map(o=>o.id));
    if(incoming&&allowed&&enabled.current)void ring().catch(error=>{
      enabled.current=false;setActive(false);setError(error instanceof Error?error.message:"Səsi yenidən aktiv et.");
    });
  },[board,allowed,ring]);
  useEffect(()=>()=>{enabled.current=false;void context.current?.close().catch(()=>{});},[]);
  async function enable() {
    try {
      setError("");
      const Audio=window.AudioContext||(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Audio)throw new Error("Bu brauzer səsi dəstəkləmir. Başqa brauzerdə aç.");
      if(!context.current||context.current.state==="closed")context.current=new Audio();
      await context.current.resume();enabled.current=true;await ring();setActive(true);
    }catch(error){enabled.current=false;setActive(false);setError(error instanceof Error?error.message:"Səs açıla bilmədi. Yenidən cəhd et.");}
  }
  function disable(){enabled.current=false;setActive(false);void context.current?.suspend().catch(()=>{});}
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Yeni sifariş səsi</p><p className="mt-1 text-xs leading-5 text-slate-500">{!allowed?"Restoran ayarlarında səs bağlıdır.":active?"Səs açıqdır. Paneli açıq, cihazın səsini eşidiləcək səviyyədə saxla.":"Bu paneli açanda səsi bir dəfə aktiv et."}</p></div><div className="flex flex-wrap gap-2">
      <button disabled={!allowed} aria-pressed={active&&allowed} onClick={()=>active?disable():void enable()} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40 ${active&&allowed?"bg-emerald-50 text-emerald-800":"bg-slate-900 text-white"}`}>{active&&allowed?<Volume2 size={16}/>:<VolumeX size={16}/>} {active&&allowed?"Səsi söndür":"Səsi aktiv et"}</button>
      {active&&allowed&&<button onClick={()=>void enable()} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm">Səsi yoxla</button>}
    </div></div>{error&&<p role="alert" className="mt-2 text-xs text-amber-800">{error}</p>}
  </div>;
}
