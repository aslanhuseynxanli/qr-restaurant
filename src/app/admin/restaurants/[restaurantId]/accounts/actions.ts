"use server";
import {readOwnerRPC} from "@/lib/owner-read";
import {accountUUID,validAccountFilters,type AccountHistory,type AccountDetail} from "@/lib/account-history";
import {validCursor,type OwnerReadResult} from "@/lib/owner-dashboard";
export async function readAccountHistoryAction(restaurantId:unknown,filters:unknown,cursor:unknown):Promise<OwnerReadResult<AccountHistory>> {
  if(!accountUUID(restaurantId)||!validAccountFilters(filters)||!validCursor(cursor))return {data:null,error:"Filtrləri düzgün seç. Ən çox 366 gün göstərilə bilər."};
  return readOwnerRPC<AccountHistory>("owner_account_history",{p_restaurant_id:restaurantId,p_branch_id:filters.branch_id,p_method:filters.method,
    p_from:filters.from,p_to:filters.to,p_search:filters.search,p_before_at:cursor?.at||null,p_before_id:cursor?.id||null,p_limit:30});
}
export async function readAccountDetailAction(restaurantId:unknown,sessionId:unknown):Promise<OwnerReadResult<AccountDetail>> {
  if(!accountUUID(restaurantId)||!accountUUID(sessionId))return {data:null,error:"Hesab seçimi düzgün deyil."};
  return readOwnerRPC<AccountDetail>("owner_account_detail",{p_restaurant_id:restaurantId,p_session_id:sessionId});
}
