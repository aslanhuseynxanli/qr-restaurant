import "server-only";
import {createClient} from "@/lib/supabase/server";
import type {OwnerReadResult} from "./owner-dashboard";
export async function readOwnerRPC<T>(name:"owner_dashboard"|"owner_activity"|"owner_account_history"|"owner_account_detail"|"owner_sales_report",args:Record<string,unknown>):Promise<OwnerReadResult<T>> {
  try {
    const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {data:null,error:"Sessiyan bitib. Yenidən daxil ol.",denied:true,unauthenticated:true};
    const {data,error}=await supabase.rpc(name,args);
    if(error?.code==="42501")return {data:null,error:"Bu restoranın sahib panelinə girişin bağlanıb. Hesabını paneldən yoxla.",denied:true};
    if(error?.message==="INVALID_FILTER")return {data:null,error:"Tarix aralığını düzgün seç. Ən çox 366 gün göstərilə bilər."};
    if(error?.message==="REPORT_TOO_LARGE")return {data:null,error:"Bu aralıqda çox sayda məhsul var. Daha qısa tarix aralığı və ya tək filial seç."};
    if(error||!data)return {data:null,error:"Məlumat yüklənmədi. Yenidən cəhd et."};
    return {data:data as T};
  }catch{return {data:null,error:"Bağlantı alınmadı. Yenidən cəhd et."};}
}
