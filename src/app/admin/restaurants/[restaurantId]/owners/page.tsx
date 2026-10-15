import Link from "next/link";
import {notFound} from "next/navigation";
import {ArrowLeft} from "lucide-react";
import {PageHeading} from "@/components/portal-ui";
import {restaurantWorkspace} from "@/lib/workspace";
import type {OwnerManagementBoard} from "@/lib/owner-management";
import OwnerPanel from "./panel";
export default async function OwnersPage({params,searchParams}:{params:Promise<{restaurantId:string}>;searchParams:Promise<{new?:string;create?:string}>}){
 const {restaurantId}=await params,{workspace,supabase}=await restaurantWorkspace(restaurantId);if(!workspace.super_admin)notFound();
 const {data,error}=await supabase.rpc("owner_management_board",{p_restaurant_id:restaurantId});if(error?.code==="42501")notFound();if(error||!data)throw new Error("Sahib siyahısı yüklənmədi.");const board=data as OwnerManagementBoard,query=await searchParams;
 return <main className="portal-page"><PageHeading eyebrow="Platforma · Sahib hesabları" title={board.restaurant_name} description="Restoran sahibinin hesabını yarat və bu restorana girişini idarə et." actions={<Link href="/admin?view=owners" className="portal-btn"><ArrowLeft size={14}/>Restoranlara qayıt</Link>}/>{query.new==="1"&&<p role="status" className="portal-notice mb-6">Restoran yaradıldı. İndi sahib hesabını əlavə et. Sahib öz panelindən filial, masa, menyu və işçi hesablarını hazırlayacaq.</p>}<OwnerPanel restaurantId={restaurantId} board={board}/></main>;
}
