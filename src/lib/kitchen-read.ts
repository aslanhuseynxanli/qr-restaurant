import "server-only";
import {createClient} from "@/lib/supabase/server";
import type {OwnerReadResult} from "./owner-dashboard";
import type {KitchenBoard,KitchenFilters} from "./kitchen";
export async function readKitchen(restaurantId:string,branchId:string,filters:KitchenFilters):Promise<OwnerReadResult<KitchenBoard>>{
  try{
    const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {data:null,error:"Yenidən daxil ol.",denied:true,unauthenticated:true};
    const {data,error}=await supabase.rpc("qr_kitchen_board",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_search:filters.search||null,p_limit:filters.limit}).abortSignal(AbortSignal.timeout(15000));
    if(error?.code==="42501")return {data:null,error:"Bu filiala girişin yoxdur.",denied:true};
    if(error||!data)return {data:null,error:"Mətbəx ekranı yüklənmədi. Yenidən cəhd et."};
    return {data:data as KitchenBoard};
  }catch{return {data:null,error:"Bağlantı alınmadı. Yenidən cəhd et."};}
}
