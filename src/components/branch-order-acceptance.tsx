"use client";

import {useRef,useState} from "react";
import {useRouter} from "next/navigation";
import {createClient} from "@/lib/supabase/client";
import type {WorkspaceBranch} from "@/lib/workspace-types";

type Branch=Pick<WorkspaceBranch,"id"|"restaurant_id"|"name"|"is_active"|"accepting_orders"|"updated_at">;
type Result={id:string;accepting_orders:boolean;updated_at:string};
type Attempt={accepting:boolean;updatedAt:string};

export default function BranchOrderAcceptance({branch,canManage}:{branch:Branch;canManage:boolean}){
 const router=useRouter(),pending=useRef(false);
 const [result,setResult]=useState<Result|null>(null),[attempt,setAttempt]=useState<Attempt|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState("");
 const current=result||branch,available=canManage&&branch.is_active;
 async function change(){
  if(pending.current||!available)return;
  const input=attempt||{accepting:!current.accepting_orders,updatedAt:current.updated_at};
  pending.current=true;setBusy(true);setError("");setAttempt(input);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
   const response=await createClient().rpc("set_branch_order_acceptance",{
    p_restaurant_id:branch.restaurant_id,p_branch_id:branch.id,
    p_accepting_orders:input.accepting,p_expected_updated_at:input.updatedAt,
   }).abortSignal(controller.signal);
   if(response.error){
    if(response.error.message==="STALE_BRANCH"){
     setAttempt(null);setError("Filial başqa səhifədən dəyişdirilib. Vəziyyəti yeniləyib yenidən yoxla.");router.refresh();
    }else if(response.error.code==="42501"){
     setAttempt(null);setError("Bu filialı dəyişmək üçün aktiv sahib hesabı ilə daxil ol.");
    }else if(["PGRST202","42883"].includes(response.error.code)){
     setAttempt(null);setError("031 yeniləməsinin SQL faylını Supabase-də işlət.");
    }else setError("Cavab alınmadı. Nəticəni yenidən yoxla.");
    return;
   }
   const data=response.data as Result|null;
   if(!data||data.id!==branch.id||data.accepting_orders!==input.accepting||typeof data.updated_at!=="string"){
    setError("Cavab alınmadı. Nəticəni yenidən yoxla.");return;
   }
   setResult(data);setAttempt(null);router.refresh();
  }catch{setError("Bağlantı alınmadı. Nəticəni yenidən yoxla.");}
  finally{clearTimeout(timer);pending.current=false;setBusy(false);}
 }
 return <section aria-label={`${branch.name} · Sifariş qəbulu`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3">
   <div className="min-w-0"><p className="text-sm font-bold">Sifariş qəbulu</p>
    <p role="status" className={`mt-1 text-sm font-semibold ${branch.is_active&&current.accepting_orders?"text-emerald-800":"text-amber-800"}`}>
     {!branch.is_active?"Filial aktiv deyil":current.accepting_orders?"Yeni sifarişlər qəbul olunur":"Yeni sifarişlər dayandırılıb"}
    </p>
   </div>
   {available&&<button type="button" disabled={busy} onClick={()=>void change()} className="portal-btn portal-btn-soft">
    {busy?"Yoxlanılır...":attempt?"Nəticəni yenidən yoxla":current.accepting_orders?"Qəbulu dayandır":"Qəbulu aç"}
   </button>}
  </div>
  <p className="mt-2 text-xs leading-5 text-slate-500">Qəbul dayandırıldıqda açıq masaların sifarişləri, çağırışları və ödənişləri davam edir.</p>
  {error&&<div className="mt-3 space-y-2"><p role="alert" className="text-sm leading-6 text-red-800">{error}</p>
   {!attempt&&<button type="button" onClick={()=>router.refresh()} className="text-sm font-semibold text-emerald-800 underline">Vəziyyəti yenilə</button>}
  </div>}
 </section>;
}
