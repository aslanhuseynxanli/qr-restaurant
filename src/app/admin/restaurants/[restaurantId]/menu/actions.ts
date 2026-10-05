"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { menuSortOrder, parseMenuPrice, uuidPattern, type MenuActionState } from "@/lib/menu-management";

const field = (form: FormData, name: string) => String(form.get(name) || "").trim();
function rpcMessage(error: { code?: string; message: string }) {
  if (error.code === "42501") return "Bu restoranın menyusunu dəyişmək üçün icazən yoxdur.";
  if (error.code === "P0001") return error.message;
  return "Məlumat yadda saxlanmadı. Yenidən cəhd et.";
}

export async function saveCategoryAction(_previous: MenuActionState, form: FormData): Promise<MenuActionState> {
  const restaurantId = field(form, "restaurant_id"), categoryId = field(form, "category_id");
  const name = field(form, "name"), description = field(form, "description");
  const order = menuSortOrder(field(form, "sort_order"));
  if (!uuidPattern.test(restaurantId) || (categoryId && !uuidPattern.test(categoryId)) || !name || name.length > 150 || description.length > 2000 || order === null)
    return { error: "Kateqoriyanın adı və sırasını düzgün doldur." };
  try {
    const supabase = await createClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) return { error: "Hesabına yenidən daxil ol." };
    const { error } = await supabase.rpc("save_menu_category", { p_restaurant_id: restaurantId, p_category_id: categoryId || null, p_name: name,
      p_description: description || null, p_sort_order: order, p_is_active: form.get("is_active") === "on" });
    if (error) return { error: rpcMessage(error) };
  } catch { return { error: "Bağlantı alınmadı. Yenidən cəhd et." }; }
  const path = `/admin/restaurants/${restaurantId}/menu`;
  revalidatePath(path);
  revalidatePath("/r/[slug]/t/[token]", "page");
  redirect(path);
}

export async function saveProductAction(_previous: MenuActionState, form: FormData): Promise<MenuActionState> {
  const restaurantId = field(form, "restaurant_id"), productId = field(form, "product_id"), categoryId = field(form, "category_id");
  const name = field(form, "name"), description = field(form, "description"), image = field(form, "image_url");
  const price = parseMenuPrice(field(form, "base_price")), order = menuSortOrder(field(form, "sort_order"));
  if (!uuidPattern.test(restaurantId) || (productId && !uuidPattern.test(productId)) || !uuidPattern.test(categoryId) ||
    !name || name.length > 150 || description.length > 2000 || price === null || order === null) return { error: "Məhsulun adı, kateqoriyası və qiymətini düzgün doldur." };
  if (image) {
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
    const prefix = `${base}/storage/v1/object/public/menu-images/${restaurantId.toLowerCase()}/`;
    if (!base || !image.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(image.slice(prefix.length)))
      return { error: "Şəkli bu restoran üçün fayl seçimi ilə yüklə." };
  }
  try {
    const supabase = await createClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) return { error: "Hesabına yenidən daxil ol." };
    const { error } = await supabase.rpc("save_menu_product", { p_restaurant_id: restaurantId, p_product_id: productId || null, p_category_id: categoryId,
      p_name: name, p_description: description || null, p_base_price: price, p_image_url: image || null, p_sort_order: order, p_is_active: form.get("is_active") === "on" });
    if (error) return { error: rpcMessage(error) };
  } catch { return { error: "Bağlantı alınmadı. Yenidən cəhd et." }; }
  const path = `/admin/restaurants/${restaurantId}/menu`;
  revalidatePath(path);
  revalidatePath("/r/[slug]/t/[token]", "page");
  redirect(path);
}
