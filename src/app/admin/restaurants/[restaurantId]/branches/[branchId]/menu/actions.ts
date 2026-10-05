"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { parseMenuPrice, uuidPattern, type MenuActionState } from "@/lib/menu-management";

export async function saveBranchProductAction(_previous: MenuActionState, form: FormData): Promise<MenuActionState> {
  const restaurantId = String(form.get("restaurant_id") || ""), branchId = String(form.get("branch_id") || ""), productId = String(form.get("product_id") || "");
  const rawPrice = String(form.get("price_override") || "").trim();
  const price = rawPrice ? parseMenuPrice(rawPrice) : null;
  if (![restaurantId, branchId, productId].every((value) => uuidPattern.test(value)) || (rawPrice && price === null)) return { error: "Qiyməti 5 və ya 5,50 kimi yaz. Ortaq qiymət üçün xananı boş saxla." };
  try {
    const supabase = await createClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) return { error: "Hesabına yenidən daxil ol." };
    const { error } = await supabase.rpc("save_branch_product", { p_restaurant_id: restaurantId, p_branch_id: branchId, p_product_id: productId,
      p_price_override: price, p_is_available: form.get("is_available") === "on", p_is_visible: form.get("is_visible") === "on" });
    if (error) return { error: error.code === "P0001" ? error.message : error.code === "42501" ? "Bu filialın menyusunu dəyişmək üçün icazən yoxdur." : "Dəyişiklik yadda saxlanmadı. Yenidən cəhd et." };
  } catch { return { error: "Bağlantı alınmadı. Yenidən cəhd et." }; }
  const path = `/admin/restaurants/${restaurantId}/branches/${branchId}/menu`;
  revalidatePath(path);
  revalidatePath("/r/[slug]/t/[token]", "page");
  redirect(path);
}
