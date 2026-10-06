"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {kitchenError,kitchenNext,type KitchenBoard,type KitchenOrder} from "./kitchen";

export function useKitchen(restaurantId:string,branchId:string,initial:KitchenBoard){
  const [board,setBoard]=useState<KitchenBoard|null>(initial),[pending,setPending]=useState("");
  const [error,setError]=useState(""),[notice,setNotice]=useState("");
  const [now,setNow]=useState(Date.parse(initial.generated_at));
  const alive=useRef(true),busy=useRef(false),denied=useRef(false),limit=useRef(initial.filters.limit);
  const controller=useRef<AbortController|null>(null),search=initial.filters.search;
  const args=useCallback((count:number)=>({p_restaurant_id:restaurantId,p_branch_id:branchId,p_search:search||null,p_limit:count}),[restaurantId,branchId,search]);
  const revoke=useCallback(()=>{denied.current=true;setBoard(null);setError(kitchenError("FORBIDDEN"));setNotice("");},[]);
  const refresh=useCallback(async(nextLimit?:number)=>{
    if(busy.current||denied.current)return;
    busy.current=true;setPending("READ");const request=new AbortController(),timer=setTimeout(()=>request.abort(),15000);controller.current=request;
    try{
      const result=await createClient().rpc("qr_kitchen_board",args(nextLimit||limit.current)).abortSignal(request.signal);
      if(!alive.current)return;
      if(result.error?.code==="42501"||result.status===401||result.status===403){revoke();return;}
      if(result.error||!result.data){setError("Yenilənmə alınmadı. Son vəziyyət göstərilir; əməliyyat üçün əvvəl paneli yenilə.");return;}
      setBoard(result.data as KitchenBoard);setError("");setNow(Date.now());if(nextLimit)limit.current=nextLimit;
    }catch{if(alive.current)setError("Bağlantı alınmadı. Son vəziyyət göstərilir; əməliyyat üçün əvvəl paneli yenilə.");}
    finally{clearTimeout(timer);controller.current=null;busy.current=false;if(alive.current)setPending("");}
  },[args,revoke]);
  const action=useCallback(async(order:KitchenOrder)=>{
    if(busy.current||denied.current||error||order.status==="READY")return;
    busy.current=true;setPending(order.id);setNotice("");
    const request=new AbortController(),timer=setTimeout(()=>request.abort(),20000);controller.current=request;let failed=false;
    try{
      const result=await createClient().rpc("qr_kitchen_action",{...args(limit.current),p_order_id:order.id,p_version:order.version,p_status:kitchenNext[order.status]}).abortSignal(request.signal);
      if(!alive.current)return;
      if(result.error?.code==="42501"||result.status===401||result.status===403){revoke();return;}
      if(result.error||!result.data){failed=true;setNotice(kitchenError(result.error?.message));return;}
      setBoard(result.data as KitchenBoard);setError("");setNow(Date.now());
      const destination=order.status==="PREPARING"?"Hazır sifarişlər":"Hazırlanan";
      setNotice(`${order.table_name} · Sifariş #${order.number} yeniləndi. “${destination}” bölməsində görünür.`);
    }catch{failed=true;if(alive.current)setNotice(kitchenError());}
    finally{
      clearTimeout(timer);controller.current=null;busy.current=false;if(alive.current)setPending("");
      // A lost reply may follow a committed change. Read the current version before another action.
      if(failed&&alive.current&&!denied.current)await refresh();
    }
  },[args,error,refresh,revoke]);
  useEffect(()=>{
    alive.current=true;
    const tick=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},4000);
    const clock=setInterval(()=>{if(document.visibilityState==="visible")setNow(Date.now());},5000);
    const visible=()=>{if(document.visibilityState==="visible"){setNow(Date.now());void refresh();}};
    document.addEventListener("visibilitychange",visible);
    return()=>{alive.current=false;clearInterval(tick);clearInterval(clock);document.removeEventListener("visibilitychange",visible);controller.current?.abort();};
  },[refresh]);
  return {board,pending,error,notice,now,refresh,action};
}
