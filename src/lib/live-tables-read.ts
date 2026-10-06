import "server-only";
import {ownerUUID,type OwnerReadResult} from "./owner-dashboard";
import {readOwnerRPC} from "./owner-read";
import {validDetailFilters,validLiveFilters,type LiveBoard,type LiveDetail,type LiveFilters,type DetailFilters} from "./live-tables";

export function readLiveTables(restaurantId:string,filters:LiveFilters):Promise<OwnerReadResult<LiveBoard>>{
  if(!ownerUUID.test(restaurantId)||!validLiveFilters(filters))return Promise.resolve({data:null,error:"Filial, masa və ya vəziyyət seçimini düzgün daxil et."});
  return readOwnerRPC<LiveBoard>("owner_live_tables",{p_restaurant_id:restaurantId,p_branch_id:filters.branch_id,p_view:filters.view,p_search:filters.search||null,p_limit:filters.limit});
}
export function readLiveDetail(restaurantId:string,tableId:string,filters:DetailFilters):Promise<OwnerReadResult<LiveDetail>>{
  if(!ownerUUID.test(restaurantId)||!ownerUUID.test(tableId)||!validDetailFilters(filters))return Promise.resolve({data:null,error:"Masa və ya sifariş seçimini düzgün daxil et."});
  return readOwnerRPC<LiveDetail>("owner_live_table_detail",{p_restaurant_id:restaurantId,p_table_id:tableId,p_mode:filters.mode,p_limit:filters.limit});
}
