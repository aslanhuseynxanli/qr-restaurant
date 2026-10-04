"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createRestaurantAction(
  _previous: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const rawName = formData.get("name");
  const rawSlug = formData.get("slug");
  const rawPhone = formData.get("phone") ?? "";
  const rawEmail = formData.get("email") ?? "";

  if (
    typeof rawName !== "string" ||
    typeof rawSlug !== "string" ||
    typeof rawPhone !== "string" ||
    typeof rawEmail !== "string"
  ) {
    return { error: "Formanı düzgün doldur." };
  }

  const name = rawName.trim();
  const slug = rawSlug.trim().toLowerCase();
  const phone = rawPhone.trim();
  const email = rawEmail.trim().toLowerCase();

  if (!name || name.length > 150) {
    return { error: "Restoran adı 1–150 simvol olmalıdır." };
  }

  if (
    slug.length > 80 ||
    !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)
  ) {
    return {
      error: "Keçid adında kiçik ingilis hərfləri, rəqəm və tire istifadə et.",
    };
  }

  if (
    phone.length > 30 ||
    email.length > 254 ||
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  ) {
    return { error: "Telefon və email məlumatlarını yoxla." };
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

    const { error } = await supabase.rpc("create_restaurant", {
      p_name: name,
      p_slug: slug,
      p_phone: phone || null,
      p_email: email || null,
    });

    if (error) {
      return {
        error:
          error.code === "23505"
            ? "Bu keçid adı artıq istifadə olunur. Başqa ad yaz."
            : error.code === "42501"
              ? "Restoran yaratmaq üçün SUPER_ADMIN rolu lazımdır."
              : error.code === "P0001"
                ? error.message
                : "Restoran yaradılmadı. Yenidən cəhd et.",
      };
    }
  } catch {
    return { error: "Bağlantı alınmadı. Yenidən cəhd et." };
  }

  revalidatePath("/admin");
  redirect("/admin");
}