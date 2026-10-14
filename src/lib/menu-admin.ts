import "server-only";
import {notFound} from "next/navigation";
import {restaurantWorkspace} from "@/lib/workspace";
export async function requireMenuAdmin(restaurantId:string){
  const {supabase,workspace}=await restaurantWorkspace(restaurantId),restaurant=workspace.restaurants.find(r=>r.id===restaurantId);
  if(!restaurant)notFound();
  return {supabase,restaurant,canManage:restaurant.can_manage,branches:workspace.branches.filter(b=>b.restaurant_id===restaurantId)};
}
