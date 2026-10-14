import "server-only";
import {cache} from "react";
import {redirect,notFound} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import type {Workspace} from "./workspace-types";

// React cache yalnız cari server renderi üçündür; müxtəlif hesablar arasında paylaşılmır.
export const portalSession=cache(async()=>{
  const supabase=await createClient(15000);
  const {data,error}=await supabase.auth.getClaims();
  if(error||!data?.claims.sub)return null;
  return {supabase,userId:data.claims.sub,email:typeof data.claims.email==="string"?data.claims.email:""};
});
export const getWorkspace=cache(async(restaurantId:string|null=null)=>{
  const session=await portalSession();
  if(!session)redirect("/login");
  const {data,error}=await session.supabase.rpc("portal_workspace",{p_restaurant_id:restaurantId});
  if(error||!data)throw new Error("İş yeri yüklənmədi. Bağlantını və 026_workspace_navigation.sql yeniləməsini yoxla.");
  return {...session,workspace:data as Workspace};
});
export async function restaurantWorkspace(restaurantId:string){
  if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(restaurantId))notFound();
  const context=await getWorkspace(restaurantId);
  if(!context.workspace.active||(!context.workspace.restaurants.some(r=>r.id===restaurantId)&&!context.workspace.assignments.some(a=>a.restaurant_id===restaurantId)))notFound();
  return context;
}
