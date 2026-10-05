import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { uuidPattern } from "./menu-management";

export async function requireMenuAdmin(restaurantId: string) {
  if (!uuidPattern.test(restaurantId)) notFound();
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth.user) redirect("/login");
  const results = await Promise.all([
    supabase.from("restaurants").select("id,name,status,is_active").eq("id", restaurantId).maybeSingle(),
    supabase.from("profiles").select("is_active").eq("id", auth.user.id).maybeSingle(),
    supabase.from("platform_admins").select("role").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle(),
    supabase.from("restaurant_members").select("role").eq("user_id", auth.user.id).eq("restaurant_id", restaurantId).eq("is_active", true).eq("role", "RESTAURANT_ADMIN").maybeSingle(),
  ]);
  if (results.some((result) => result.error)) throw new Error("Restoran məlumatları yüklənmədi.");
  const [restaurant, profile, platform, member] = results;
  if (!restaurant.data || profile.data?.is_active !== true ||
    (platform.data?.role !== "SUPER_ADMIN" && member.data?.role !== "RESTAURANT_ADMIN")) notFound();
  return { supabase, restaurant: restaurant.data, canManage: restaurant.data.is_active && ["trial", "active"].includes(restaurant.data.status) };
}
