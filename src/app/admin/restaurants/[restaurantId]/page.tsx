import {notFound,redirect} from "next/navigation";
import {restaurantWorkspace} from "@/lib/workspace";
import {readDashboardAction} from "./dashboard-actions";
import {ownerUUID} from "@/lib/owner-dashboard";
import DashboardPanel from "./dashboard-panel";
import DashboardUnavailable from "./dashboard-unavailable";
export default async function RestaurantPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<{branch?:string}>}){
 const {restaurantId}=await params,{workspace}=await restaurantWorkspace(restaurantId);if(workspace.super_admin)redirect(`/admin/restaurants/${restaurantId}/owners`);
 const query=await searchParams,branch=typeof query.branch==="string"&&ownerUUID.test(query.branch)?query.branch:null,result=await readDashboardAction(restaurantId,branch);
 if(result.unauthenticated)redirect("/login");if(result.denied)notFound();return <main className="portal-page">{result.data?<DashboardPanel key={`${restaurantId}:${branch||"all"}`} restaurantId={restaurantId} initialBoard={result.data}/>:<DashboardUnavailable error={result.error}/>}</main>;
}
