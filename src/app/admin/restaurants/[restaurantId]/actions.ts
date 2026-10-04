"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createBranchAction(
  _previous: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const fields = [
    "restaurant_id",
    "name",
    "latitude",
    "longitude",
    "radius",
    "address",
    "phone",
  ];

  const values = fields.map((field) => formData.get(field) ?? "");

  if (values.some((value) => typeof value !== "string")) {
    return { error: "Formanı düzgün doldur." };
  }

  const [
    restaurantId, name, latText, lngText,
    radiusText, address, phone,
  ] = values.map((value) => String(value).trim());

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      restaurantId,
    )
  ) {
    return { error: "Restoran məlumatı düzgün deyil." };
  }

  if (
    !name || name.length > 150 ||
    address.length > 500 || phone.length > 30
  ) {
    return {
      error: "Filial adı, ünvan və telefon məlumatlarını yoxla.",
    };
  }

  const latitude = Number(latText);
  const longitude = Number(lngText);
  const radius = Number(radiusText);

  if (
    !latText || !lngText ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
    latitude < -90 || latitude > 90 ||
    longitude < -180 || longitude > 180
  ) {
    return { error: "Koordinatları düzgün daxil et." };
  }

  if (
    !radiusText || !Number.isInteger(radius) ||
    radius < 1 || radius > 2147483647
  ) {
    return { error: "Radius müsbət tam ədəd olmalıdır." };
  }

  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return { error: "Sessiyan bitib. Yenidən daxil ol." };
    }

    const { error } = await supabase.rpc("create_branch", {
      p_restaurant_id: restaurantId,
      p_name: name,
      p_latitude: latitude,
      p_longitude: longitude,
      p_address: address || null,
      p_phone: phone || null,
      p_allowed_radius_meters: radius,
      p_accepting_orders: formData.has("accepting_orders"),
    });

    if (error) {
      return {
        error:
          error.code === "42501"
            ? "Bu restorana filial əlavə etmək icazən yoxdur."
            : error.code === "P0001"
              ? error.message
              : "Filial yaradılmadı. Yenidən cəhd et.",
      };
    }
  } catch {
    return { error: "Bağlantı alınmadı. Yenidən cəhd et." };
  }

  revalidatePath("/admin");
  revalidatePath(`/admin/restaurants/${restaurantId}`);
  redirect(`/admin/restaurants/${restaurantId}`);
}