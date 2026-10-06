"use client";

import { useCallback,useEffect,useRef,useState } from "react";
import { Volume2,VolumeX } from "lucide-react";
import type { StaffBoard } from "@/lib/qr-orders";

function notifications(board:StaffBoard) {
  return board.sessions.flatMap(session=>[
    ...session.orders.map(order=>({id:`order:${order.id}`,status:order.status})),
    ...session.services.map(call=>({id:`call:${call.id}`,status:call.status})),
  ]);
}

export default function OrderSound({board}:{board:StaffBoard}) {
  const context=useRef<AudioContext|null>(null);
  const enabled=useRef(false);
  const known=useRef(new Set(notifications(board).map(item=>item.id)));
  const volumeRef=useRef(100),nextChime=useRef(0);
  const [volume,setVolume]=useState(100);
  const [active,setActive]=useState(false),[error,setError]=useState("");
  const allowed=board.sound_enabled!==false;
  const ring=useCallback(async()=>{
    const audio=context.current;
    if(!audio||!enabled.current)return;
    if(audio.state!=="running")throw new Error("Səs dayandırılıb. Yenidən aktiv et.");
    const peak=volumeRef.current/100*0.5;
    if(peak<=0)return;
    const beginning=Math.max(audio.currentTime,nextChime.current);
    nextChime.current=beginning+0.84;
    [880,1175,880].forEach((frequency,index)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain(),start=beginning+index*0.28;
      oscillator.type="triangle";oscillator.frequency.setValueAtTime(frequency,start);
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,start+0.015);gain.gain.exponentialRampToValueAtTime(0.0001,start+0.21);
      oscillator.connect(gain);gain.connect(audio.destination);
      oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(start);oscillator.stop(start+0.23);
    });
  },[]);
  useEffect(()=>{
    const items=notifications(board);
    const incoming=items.some(item=>item.status==="NEW"&&!known.current.has(item.id));
    // Keep the previous snapshot as well: stale poll responses cannot ring a second time.
    for(const item of items)known.current.add(item.id);
    if(known.current.size>10000)known.current=new Set(items.map(item=>item.id));
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
      if(!context.current||context.current.state==="closed"){context.current=new Audio();nextChime.current=0;}
      await context.current.resume();enabled.current=true;await ring();setActive(true);
    }catch(error){enabled.current=false;setActive(false);setError(error instanceof Error?error.message:"Səs açıla bilmədi. Yenidən cəhd et.");}
  }
  function disable(){enabled.current=false;setActive(false);nextChime.current=0;const old=context.current;context.current=null;void old?.close().catch(()=>{});}
  return <div className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-semibold">Sifariş və çağırış səsi</p><p className="mt-1 text-xs leading-5 text-slate-500">{!allowed?"Restoran ayarlarında səs bağlıdır.":active?"Yeni sifariş, ofisiant və hesab çağırışı səs verəcək. Paneli açıq saxla.":"Bu paneli açanda səsi bir dəfə aktiv et."}</p></div><div className="flex flex-wrap gap-2">
      <button disabled={!allowed} aria-pressed={active&&allowed} onClick={()=>active?disable():void enable()} className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold disabled:opacity-40 ${active&&allowed?"bg-emerald-50 text-emerald-800":"bg-slate-900 text-white"}`}>{active&&allowed?<Volume2 size={16}/>:<VolumeX size={16}/>} {active&&allowed?"Səsi söndür":"Səsi aktiv et"}</button>
      {active&&allowed&&<button onClick={()=>void enable()} className="min-h-11 rounded-xl border border-slate-200 px-4 py-2 text-sm">Səsi yoxla</button>}
    </div></div>
    <label className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs font-medium text-slate-600"><span>Səs səviyyəsi: {volume}%</span><input aria-label="Bildiriş səsinin səviyyəsi" type="range" min="0" max="100" step="10" value={volume} disabled={!allowed} onChange={event=>{const value=Number(event.target.value);volumeRef.current=value;setVolume(value);}} className="h-8 min-w-0 flex-1 accent-emerald-800 disabled:opacity-40"/></label>
    {error&&<p role="alert" className="mt-2 text-xs text-amber-800">{error}</p>}
  </div>;
}
