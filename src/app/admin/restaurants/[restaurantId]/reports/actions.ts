"use server";
import {readOwnerRPC} from "@/lib/owner-read";
import {ownerUUID,type OwnerReadResult} from "@/lib/owner-dashboard";
import {validSalesFilters,type SalesReport} from "@/lib/sales-report";
export async function readSalesReportAction(restaurantId:unknown,filters:unknown):Promise<OwnerReadResult<SalesReport>> {
  if(typeof restaurantId!=="string"||!ownerUUID.test(restaurantId)||!validSalesFilters(filters))return {data:null,error:"Tarix aralığını düzgün seç. Ən çox 366 gün göstərilə bilər."};
  return readOwnerRPC<SalesReport>("owner_sales_report",{p_restaurant_id:restaurantId,p_branch_id:filters.branch_id,p_from:filters.from,p_to:filters.to});
}
