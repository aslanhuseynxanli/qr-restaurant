"use client";
import {Volume2,VolumeX,Settings2} from "lucide-react";
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
  return <section aria-label="Mətbəx bildiriş səsi" className="portal-sound"><button type="button" disabled={!allowed} aria-pressed={active&&allowed} onClick={()=>active?disable():void enable()} className="portal-sound-toggle">{active&&allowed?<Volume2 size={13}/>:<VolumeX size={13}/>} {active&&allowed?"Səsi söndür":"Səsi aktiv et"}</button><details><summary aria-label="Mətbəx səsi ayarları"><Settings2 size={14}/></summary><div><p className="font-bold">Yeni sifariş səsi</p><p className="mt-2 leading-5">{!allowed?"Restoran ayarlarında səs bağlıdır.":"Yeni sifarişlər üçün ekranı açıq saxla."}</p><label className="mt-3 block">Səs səviyyəsi: {volume}%<input aria-label="Mətbəx səsinin səviyyəsi" type="range" min="0" max="100" step="10" disabled={!allowed} value={volume} onChange={e=>{const v=Number(e.target.value);volumeRef.current=v;setVolume(v);}}/></label>{active&&allowed&&<button type="button" onClick={()=>void enable()} className="portal-btn w-full">Səsi yoxla</button>}</div></details>{error&&<p role="alert" className="text-xs text-amber-700">{error}</p>}</section>;
}
