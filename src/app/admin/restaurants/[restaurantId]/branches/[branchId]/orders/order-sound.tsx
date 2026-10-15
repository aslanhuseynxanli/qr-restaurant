"use client";

import { useCallback,useEffect,useRef,useState } from "react";
import { Volume2,VolumeX,Settings2 } from "lucide-react";
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
  const readyKnown=useRef(new Set(notifications(board).filter(item=>item.status==="READY").map(item=>item.id)));
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
    const incoming=items.some(item=>item.status==="NEW"&&!known.current.has(item.id)&&(board.can_prepare!==false||item.id.startsWith("call:")));
    const prepared=board.can_prepare===false&&items.some(item=>item.status==="READY"&&!readyKnown.current.has(item.id));
    for(const item of items)if(item.status==="READY")readyKnown.current.add(item.id);
    if(readyKnown.current.size>10000)readyKnown.current=new Set(items.filter(item=>item.status==="READY").map(item=>item.id));
    // Keep the previous snapshot as well: stale poll responses cannot ring a second time.
    for(const item of items)known.current.add(item.id);
    if(known.current.size>10000)known.current=new Set(items.map(item=>item.id));
    if((incoming||prepared)&&allowed&&enabled.current)void ring().catch(error=>{
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
  return <section aria-label="Ofisiant bildiriş səsi" className="portal-sound"><button type="button" disabled={!allowed} aria-pressed={active&&allowed} onClick={()=>active?disable():void enable()} className="portal-sound-toggle">{active&&allowed?<Volume2 size={13}/>:<VolumeX size={13}/>} {active&&allowed?"Səsi söndür":"Səsi aktiv et"}</button><details><summary aria-label="Bildiriş səsi ayarları"><Settings2 size={14}/></summary><div><p className="font-bold">Bildiriş səsi</p><p className="mt-2 leading-5">{!allowed?"Restoran ayarlarında səs bağlıdır.":"Bu ekranı açıq saxla. Yeni çağırış və hazır sifariş səs verəcək."}</p><label className="mt-3 block">Səs səviyyəsi: {volume}%<input aria-label="Bildiriş səsinin səviyyəsi" type="range" min="0" max="100" step="10" value={volume} disabled={!allowed} onChange={e=>{const v=Number(e.target.value);volumeRef.current=v;setVolume(v);}}/></label>{active&&allowed&&<button type="button" onClick={()=>void enable()} className="portal-btn w-full">Səsi yoxla</button>}</div></details>{error&&<p role="alert" className="text-xs text-amber-700">{error}</p>}</section>;
}
