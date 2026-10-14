import {loadMenuCategories,loadMenuProducts} from "@/lib/menu-query";
import {requireMenuAdmin} from "@/lib/menu-admin";
import MenuManager from "./menu-manager";
export default async function MenuAdminPage({params}:{params:Promise<{restaurantId:string}>}){
  const {restaurantId}=await params,{supabase,canManage,branches}=await requireMenuAdmin(restaurantId);
  const [categories,products]=await Promise.all([loadMenuCategories(supabase,restaurantId),loadMenuProducts(supabase,restaurantId)]);
  if(categories.error||products.error)throw new Error("Menyu yüklənmədi.");
  return <main className="mx-auto max-w-6xl px-4 py-7 sm:px-8"><MenuManager restaurantId={restaurantId} categories={categories.data} products={products.data} branches={branches} canManage={canManage}/></main>;
}
