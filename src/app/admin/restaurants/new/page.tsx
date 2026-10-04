import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RestaurantForm from "./restaurant-form";

export default async function NewRestaurantPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) redirect("/login");

  const [profile, admin] = await Promise.all([
    supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.id)
      .maybeSingle(),

    supabase
      .from("platform_admins")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (profile.error || admin.error) {
    throw new Error("Hesab icazələri yoxlanmadı.");
  }

  if (
    !profile.data?.is_active ||
    admin.data?.role !== "SUPER_ADMIN"
  ) {
    redirect("/admin");
  }

  return <RestaurantForm />;
}