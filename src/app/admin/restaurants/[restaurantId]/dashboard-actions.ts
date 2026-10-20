"use server";
import {readOwnerRPC} from "@/lib/owner-read";
import {ownerUUID,isOwnerDashboard,validCursor,validFilters,type OwnerDashboard,type OwnerActivity,type OwnerReadResult,type ActivityFilters,type ActivityCursor} from "@/lib/owner-dashboard";

export async function readDashboardAction(restaurantId:string,branchId:string|null):Promise<OwnerReadResult<OwnerDashboard>> {
  if(typeof restaurantId!=="string"||!ownerUUID.test(restaurantId)||(branchId!==null&&(typeof branchId!=="string"||!ownerUUID.test(branchId))))return {data:null,error:"Restoran və ya filial düzgün deyil."};
  const result=await readOwnerRPC<OwnerDashboard>("owner_dashboard",{p_restaurant_id:restaurantId,p_branch_id:branchId});
  if(result.data&&!isOwnerDashboard(result.data))return {data:null,error:"Panelin məlumatları tam alınmadı. Yenidən yoxla; problem davam edərsə platforma admininə bildir."};
  return result;
}
export async function readActivityAction(restaurantId:string,filters:ActivityFilters,cursor:ActivityCursor|null):Promise<OwnerReadResult<OwnerActivity>> {
  if(typeof restaurantId!=="string"||!ownerUUID.test(restaurantId)||!validFilters(filters)||!validCursor(cursor))return {data:null,error:"Tarixçə filtrləri düzgün deyil. Səhifəni yenilə."};
  return readOwnerRPC<OwnerActivity>("owner_activity",{p_restaurant_id:restaurantId,p_branch_id:filters.branch_id,p_category:filters.category,p_from:filters.from,p_to:filters.to,p_before_at:cursor?.at||null,p_before_id:cursor?.id||null,p_limit:30});
}
