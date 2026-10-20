import {notFound} from "next/navigation";
import {restaurantWorkspace} from "@/lib/workspace";
import {uuidPattern} from "@/lib/menu-management";
import type {Receipt} from "@/lib/daily-operations";
import AccountReceipt from "@/components/account-receipt";
export default async function ReceiptPage({params}:{params:Promise<{restaurantId:string;branchId:string;sessionId:string}>}){
 const {restaurantId,branchId,sessionId}=await params;if(![restaurantId,branchId,sessionId].every(v=>uuidPattern.test(v)))notFound();
 const {supabase}=await restaurantWorkspace(restaurantId);
 const {data,error}=await supabase.rpc("qr_account_receipt",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_session_id:sessionId});
 if(error?.code==="42501")notFound();if(error||!data)throw new Error("Hesab yüklənmədi. 028 yeniləməsini yoxla.");
 return <main className="portal-page"><AccountReceipt receipt={data as Receipt} back={`/admin/restaurants/${restaurantId}/branches/${branchId}/orders`}/></main>;
}
