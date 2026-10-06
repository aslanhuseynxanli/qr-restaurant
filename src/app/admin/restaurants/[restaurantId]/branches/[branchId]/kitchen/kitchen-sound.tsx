"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {newerKitchenNumber} from "@/lib/kitchen";

export default function KitchenSound({latest,allowed}:{latest:string|null;allowed:boolean}){
  const context=useRef<AudioContext|null>(null),enabled=useRef(false),seen=useRef(latest),volumeRef=useRef(100),nextChime=useRef(0);
  const [active,setActive]=useState(false),[volume,setVolume]=useState(100),[error,setError]=useState("");
  const ring=useCallback(async()=>{
    const audio=context.current;if(!audio||!enabled.current||volumeRef.current===0)return;
    if(audio.state!=="running")throw new Error("Səs dayandırılıb. Yenidən aktiv et.");
    const beginning=Math.max(audio.currentTime,nextChime.current),peak=volumeRef.current/100*0.5;nextChime.current=beginning+0.84;
    [880,1175,880].forEach((frequency,index)=>{
      const oscillator=audio.createOscillator(),gain=audio.createGain(),start=beginning+index*0.28;
      oscillator.type="triangle";oscillator.frequency.setValueAtTime(frequency,start);
      gain.gain.setValueAtTime(0,start);gain.gain.linearRampToValueAtTime(peak,start+0.015);gain.gain.exponentialRampToValueAtTime(0.0001,start+0.21);
      oscillator.connect(gain);gain.connect(audio.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};
      oscillator.start(start);oscillator.stop(start+0.23);
    });
  },[]);
  useEffect(()=>{
    if(!newerKitchenNumber(latest,seen.current))return;seen.current=latest;
    if(allowed&&enabled.current)void ring().catch(e=>{enabled.current=false;setActive(false);setError(e instanceof Error?e.message:"Səsi yenidən aktiv et.");});
  },[latest,allowed,ring]);
  useEffect(()=>()=>{enabled.current=false;void context.current?.close().catch(()=>{});},[]);
  async function enable(){
    try{
      setError("");const Audio=window.AudioContext||(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
      if(!Audio)throw new Error("Bu brauzer səsi dəstəkləmir.");
      if(!context.current||context.current.state==="closed"){context.current=new Audio();nextChime.current=0;}
      await context.current.resume();enabled.current=true;await ring();setActive(true);
    }catch(e){enabled.current=false;setActive(false);setError(e instanceof Error?e.message:"Səs açıla bilmədi.");}
  }
  function disable(){enabled.current=false;setActive(false);nextChime.current=0;const old=context.current;context.current=null;void old?.close().catch(()=>{});}
  return <section aria-label="Mətbəx bildiriş səsi" className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="text-sm font-semibold">Yeni sifariş səsi</p><p className="mt-1 text-xs leading-5 text-slate-500">{!allowed?"Restoran ayarlarında səs bağlıdır.":active?"Yeni sifariş səs verəcək. Mətbəx ekranını açıq saxla.":"Bu ekranı açanda səsi bir dəfə aktiv et."}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={!allowed} aria-pressed={active&&allowed} onClick={()=>active?disable():void enable()} className="min-h-11 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40">{active&&allowed?"Səsi söndür":"Səsi aktiv et"}</button>{active&&allowed&&<button type="button" onClick={()=>void enable()} className="min-h-11 rounded-xl border border-slate-200 px-4 py-3 text-sm">Səsi yoxla</button>}</div></div>
    <label className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-600"><span>Səs səviyyəsi: {volume}%</span><input aria-label="Mətbəx səsinin səviyyəsi" type="range" min="0" max="100" step="10" disabled={!allowed} value={volume} onChange={e=>{const value=Number(e.target.value);volumeRef.current=value;setVolume(value);}} className="h-8 min-w-0 flex-1 accent-emerald-800"/></label>
    {error&&<p role="alert" className="text-sm text-amber-800">{error}</p>}
  </section>;
}
