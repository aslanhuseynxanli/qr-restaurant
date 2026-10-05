import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { BranchProduct, MenuCategory, MenuProduct } from "./menu-management";
type Client = Awaited<ReturnType<typeof createClient>>;

// Read all pages so an import does not hide rows beyond PostgREST's page limit.
export async function loadMenuCategories(supabase: Client, restaurantId: string) {
  const rows: MenuCategory[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("categories").select("id,name,description,sort_order,is_active,updated_at").eq("restaurant_id", restaurantId).order("sort_order").order("name").order("id").range(offset, offset + 499);
    if (result.error) return { data: [] as MenuCategory[], error: result.error };
    rows.push(...(result.data as MenuCategory[]));
    if (result.data.length < 500) return { data: rows, error: null };
  }
}
export async function loadMenuProducts(supabase: Client, restaurantId: string) {
  const rows: MenuProduct[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("products").select("id,category_id,name,description,base_price,image_url,sort_order,is_active,updated_at").eq("restaurant_id", restaurantId).order("sort_order").order("name").order("id").range(offset, offset + 499);
    if (result.error) return { data: [] as MenuProduct[], error: result.error };
    rows.push(...(result.data as MenuProduct[]));
    if (result.data.length < 500) return { data: rows, error: null };
  }
}
export async function loadBranchProductSettings(supabase: Client, restaurantId: string, branchId: string) {
  const rows: BranchProduct[] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await supabase.from("branch_product_settings").select("product_id,price_override,is_available,is_visible,updated_at").eq("restaurant_id", restaurantId).eq("branch_id", branchId).order("product_id").range(offset, offset + 499);
    if (result.error) return { data: [] as BranchProduct[], error: result.error };
    rows.push(...(result.data as BranchProduct[]));
    if (result.data.length < 500) return { data: rows, error: null };
  }
}
