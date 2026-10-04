"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function signInAction(
  _previous: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  const emailValue = formData.get("email");
  const passwordValue = formData.get("password");

  if (
    typeof emailValue !== "string" ||
    typeof passwordValue !== "string"
  ) {
    return { error: "Email və şifrəni daxil et." };
  }

  const email = emailValue.trim().toLowerCase();
  const password = passwordValue;

  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !password ||
    password.length > 1024
  ) {
    return { error: "Email və şifrəni düzgün daxil et." };
  }

  try {
    const supabase = await createClient();

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      return {
        error:
          error.code === "invalid_credentials"
            ? "Email və ya şifrə yanlışdır."
            : "Giriş alınmadı. Hesab məlumatlarını yoxlayıb yenidən cəhd et.",
      };
    }
  } catch {
    return { error: "Bağlantı alınmadı. Yenidən cəhd et." };
  }

  revalidatePath("/", "layout");
  redirect("/admin");
}

export async function signOutAction() {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut({
    scope: "local",
  });

  if (error) {
    throw new Error("Hesabdan çıxış alınmadı. Yenidən cəhd et.");
  }

  revalidatePath("/", "layout");
  redirect("/login");
}