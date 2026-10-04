"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function text(data: FormData, name: string) {
  const value = data.get(name);
  return typeof value === "string" ? value.trim() : "";
}
function errorMessage(error: { code?: string; message?: string }) {
  if (error.code === "42501") return "Bu əməliyyat üçün icazən yoxdur.";
  if (error.code === "23505") return "Bu filialda həmin nömrəli masa artıq var.";
  if (error.code === "P0001") return error.message || "Məlumatları yoxla.";
  return "Əməliyyat alınmadı. Yenidən cəhd et.";
}

export async function createTableAction(_previous: { error: string }, data: FormData) {
  const restaurantId = text(data, "restaurant_id");
  const branchId = text(data, "branch_id");
  const numberText = text(data, "table_number");
  const tableNumber = Number(numberText);
  const name = text(data, "name");
  if (!uuid.test(restaurantId) || !uuid.test(branchId)) return { error: "Filial məlumatı düzgün deyil." };
  if (!numberText || !Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 2147483647) return { error: "Masa nömrəsi müsbət tam ədəd olmalıdır." };
  if (name.length > 150) return { error: "Masa adı ən çox 150 simvol ola bilər." };
  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return { error: "Yenidən hesabına daxil ol." };
    const { error } = await supabase.rpc("create_table", {
      p_restaurant_id: restaurantId, p_branch_id: branchId,
      p_table_number: tableNumber, p_name: name || null,
    });
    if (error) return { error: errorMessage(error) };
  } catch { return { error: "Bağlantı alınmadı. Yenidən cəhd et." }; }
  const path = `/admin/restaurants/${restaurantId}/branches/${branchId}`;
  revalidatePath(path);
  redirect(path);
}

export async function updateLocationAction(_previous: { error: string }, data: FormData) {
  const restaurantId = text(data, "restaurant_id");
  const branchId = text(data, "branch_id");
  const latitudeText = text(data, "latitude");
  const longitudeText = text(data, "longitude");
  const latitude = Number(latitudeText);
  const longitude = Number(longitudeText);
  const radiusText = text(data, "radius");
  const radius = Number(radiusText);
  const address = text(data, "address");
  if (!uuid.test(restaurantId) || !uuid.test(branchId)) return { error: "Filial məlumatı düzgün deyil." };
  if (!latitudeText || !longitudeText || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { error: "Xəritədə yer seç." };
  if (!radiusText || !Number.isInteger(radius) || radius < 1 || radius > 2147483647) return { error: "Radius müsbət tam ədəd olmalıdır." };
  if (address.length > 500) return { error: "Ünvan ən çox 500 simvol ola bilər." };
  try {
    const supabase = await createClient();
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || !auth.user) return { error: "Yenidən hesabına daxil ol." };
    const { error } = await supabase.rpc("set_branch_location", {
      p_restaurant_id: restaurantId, p_branch_id: branchId,
      p_latitude: latitude, p_longitude: longitude,
      p_allowed_radius_meters: radius, p_address: address || null,
    });
    if (error) return { error: errorMessage(error) };
  } catch { return { error: "Bağlantı alınmadı. Yenidən cəhd et." }; }
  const path = `/admin/restaurants/${restaurantId}/branches/${branchId}`;
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  revalidatePath(path);
  redirect(path);
}
