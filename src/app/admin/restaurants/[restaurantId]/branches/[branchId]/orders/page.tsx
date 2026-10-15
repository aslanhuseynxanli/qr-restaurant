import { notFound } from "next/navigation";
import { restaurantWorkspace } from "@/lib/workspace";
import { uuidPattern } from "@/lib/menu-management";
import type { StaffBoard } from "@/lib/qr-orders";
import OrdersPanel from "./panel";

export default async function OrdersPage({params}:{params:Promise<{restaurantId:string;branchId:string}>}) {
  const {restaurantId,branchId}=await params;
  if(!uuidPattern.test(restaurantId)||!uuidPattern.test(branchId))notFound();
  const {supabase,workspace}=await restaurantWorkspace(restaurantId);
  const branch=workspace.branches.find(b=>b.id===branchId)||workspace.assignments.find(b=>b.id===branchId&&b.restaurant_id===restaurantId);
  if(!branch)notFound();
  const board=await supabase.rpc("qr_staff_board",{p_restaurant_id:restaurantId,p_branch_id:branchId});
  if(board.error?.code==="42501")notFound();
  if(board.error||!board.data)throw new Error("Sifariş paneli yüklənmədi.");
  return <main className="portal-page"><OrdersPanel key={branchId} restaurantId={restaurantId} branchId={branchId} branchName={branch.name} initialBoard={board.data as StaffBoard}/></main>;
}
