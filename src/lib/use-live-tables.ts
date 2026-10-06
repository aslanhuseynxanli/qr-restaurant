"use client";
import {useCallback,useEffect,useRef,useState} from "react";

export function useLiveTables<T extends {generated_at:string}>(initial:T,initialURL:string){
  const [data,setData]=useState<T|null>(initial),[pending,setPending]=useState(false),[error,setError]=useState("");
  const [automatic,setAutomatic]=useState(true),[now,setNow]=useState(Date.parse(initial.generated_at));
  const alive=useRef(true),busy=useRef(false),denied=useRef(false),url=useRef(initialURL),controller=useRef<AbortController|null>(null);
  const refresh=useCallback(async(nextURL?:string)=>{
    if(busy.current||denied.current)return;
    busy.current=true;setPending(true);
    const request=new AbortController(),timer=setTimeout(()=>request.abort(),20000);controller.current=request;
    try{
      const response=await fetch(nextURL||url.current,{cache:"no-store",signal:request.signal});
      const result=await response.json();if(!alive.current)return;
      if(response.status===401||response.status===403){denied.current=true;setData(null);setError(result.error||"Sahib panelinə girişin bağlanıb. Hesabını yoxla.");return;}
      if(!response.ok||!result.data){setError(result.error||"Məlumat yenilənmədi. Son alınmış vəziyyət göstərilir.");return;}
      setData(result.data as T);setError("");setNow(Date.now());if(nextURL)url.current=nextURL;
    }catch{if(alive.current)setError("Bağlantı alınmadı. Son alınmış vəziyyət göstərilir; yenidən cəhd et.");}
    finally{clearTimeout(timer);controller.current=null;busy.current=false;if(alive.current)setPending(false);}
  },[]);
  useEffect(()=>{
    alive.current=true;
    const clock=setInterval(()=>{if(document.visibilityState==="visible")setNow(Date.now());},5000);
    const tick=setInterval(()=>{if(automatic&&document.visibilityState==="visible")void refresh();},10000);
    const visible=()=>{if(document.visibilityState==="visible"){setNow(Date.now());if(automatic)void refresh();}};
    document.addEventListener("visibilitychange",visible);
    return()=>{clearInterval(clock);clearInterval(tick);document.removeEventListener("visibilitychange",visible);};
  },[automatic,refresh]);
  useEffect(()=>()=>{alive.current=false;controller.current?.abort();},[]);
  return {data,pending,error,automatic,setAutomatic,now,refresh};
}
