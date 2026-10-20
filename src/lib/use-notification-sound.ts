"use client";
import {useCallback,useEffect,useRef,useState} from "react";

const key="qr-restaurant:notification-sound:v1";
type Preference={enabled:boolean;volume:number};
function read():Preference{try{const v=JSON.parse(localStorage.getItem(key)||"null");if(v&&typeof v.enabled==="boolean"&&Number.isInteger(v.volume)&&v.volume>=0&&v.volume<=100)return v;}catch{}return {enabled:false,volume:100};}
function save(p:Preference){try{localStorage.setItem(key,JSON.stringify(p));window.dispatchEvent(new Event("qr-sound-preference"));}catch{}}

// A saved preference is independent from browser autoplay permission. Never claim
// sound is running while the AudioContext is suspended. No silent-loop workaround.
export function useNotificationSound(allowed:boolean){
 const context=useRef<AudioContext|null>(null),wanted=useRef(false),level=useRef(100),next=useRef(0),queued=useRef(false),mounted=useRef(false);
 const [ready,setReady]=useState(false),[enabled,setEnabled]=useState(false),[volume,setVolumeState]=useState(100),[status,setStatus]=useState<"off"|"waiting"|"running"|"unavailable">("off");
 const allowedRef=useRef(allowed);
 const prepare=useCallback(()=>{
  if(!allowedRef.current||!wanted.current)return;
  const Audio=window.AudioContext||(window as Window&{webkitAudioContext?:typeof AudioContext}).webkitAudioContext;
  if(!Audio){setStatus("unavailable");return;}
  if(!context.current||context.current.state==="closed"){
   const audio=new Audio();context.current=audio;next.current=0;
   audio.onstatechange=()=>{if(mounted.current&&wanted.current&&allowedRef.current)setStatus(audio.state==="running"?"running":"waiting");};
  }
  const audio=context.current;
  if(audio.state==="running")setStatus("running");else{setStatus("waiting");void audio.resume().then(()=>{if(mounted.current&&wanted.current&&context.current===audio)setStatus(audio.state==="running"?"running":"waiting");}).catch(()=>{if(mounted.current)setStatus("waiting");});}
 },[]);
 const play=useCallback(()=>{
  const audio=context.current;if(!wanted.current||!allowedRef.current||level.current===0)return;
  if(!audio||audio.state!=="running"){queued.current=true;prepare();return;}
  queued.current=false;const start=Math.max(audio.currentTime,next.current),peak=level.current/100*0.5;next.current=start+0.84;
  [880,1175,880].forEach((hz,index)=>{const oscillator=audio.createOscillator(),gain=audio.createGain(),at=start+index*0.28;oscillator.type="triangle";oscillator.frequency.setValueAtTime(hz,at);gain.gain.setValueAtTime(0,at);gain.gain.linearRampToValueAtTime(peak,at+0.015);gain.gain.exponentialRampToValueAtTime(0.0001,at+0.21);oscillator.connect(gain);gain.connect(audio.destination);oscillator.onended=()=>{oscillator.disconnect();gain.disconnect();};oscillator.start(at);oscillator.stop(at+0.23);});
 },[prepare]);
 useEffect(()=>{
  mounted.current=true;
  const restore=()=>{const p=read();wanted.current=p.enabled;level.current=p.volume;setEnabled(p.enabled);setVolumeState(p.volume);setReady(true);if(p.enabled&&allowedRef.current)prepare();else{setStatus("off");queued.current=false;void context.current?.suspend().catch(()=>{});}};
  const gesture=(e:Event)=>{if(e.isTrusted&&wanted.current&&allowedRef.current)prepare();};
  const visible=()=>{if(document.visibilityState==="visible"&&wanted.current)prepare();};
  restore();window.addEventListener("storage",restore);window.addEventListener("qr-sound-preference",restore);document.addEventListener("pointerup",gesture);document.addEventListener("keydown",gesture);document.addEventListener("visibilitychange",visible);
  return()=>{mounted.current=false;window.removeEventListener("storage",restore);window.removeEventListener("qr-sound-preference",restore);document.removeEventListener("pointerup",gesture);document.removeEventListener("keydown",gesture);document.removeEventListener("visibilitychange",visible);const old=context.current;context.current=null;if(old){old.onstatechange=null;void old.close().catch(()=>{});}};
 },[prepare]);
 useEffect(()=>{allowedRef.current=allowed;if(allowed&&wanted.current)prepare();else if(!allowed){void context.current?.suspend().catch(()=>{});}},[allowed,prepare]);
 useEffect(()=>{if(status==="running"&&queued.current)play();},[status,play]);
 const toggle=()=>{const p={enabled:!wanted.current,volume:level.current};wanted.current=p.enabled;setEnabled(p.enabled);save(p);if(p.enabled){prepare();queued.current=true;play();}else{queued.current=false;next.current=0;setStatus("off");void context.current?.suspend().catch(()=>{});}};
 const setVolume=(v:number)=>{if(!Number.isInteger(v)||v<0||v>100)return;level.current=v;setVolumeState(v);save({enabled:wanted.current,volume:v});};
 return {ready,enabled,volume,status,toggle,setVolume,ring:play,test:()=>{prepare();play();}};
}
