// restaurant-menu-layout-v1
import { createClient } from "@/lib/supabase/server";
import { uuidPattern } from "@/lib/menu-management";
import MenuNavigation from "./menu-navigation";

export default async function RestaurantLayout({ children, params }: { children: React.ReactNode; params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  if (!uuidPattern.test(restaurantId)) return children;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return children;
  const [profile, platform, member] = await Promise.all([
    supabase.from("profiles").select("is_active").eq("id", auth.user.id).maybeSingle(),
    supabase.from("platform_admins").select("role").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle(),
    supabase.from("restaurant_members").select("role").eq("user_id", auth.user.id).eq("restaurant_id", restaurantId).eq("is_active", true).eq("role", "RESTAURANT_ADMIN").maybeSingle(),
  ]);
  const allowed = !profile.error && !platform.error && !member.error && profile.data?.is_active === true
    && (platform.data?.role === "SUPER_ADMIN" || member.data?.role === "RESTAURANT_ADMIN");
  return <>{allowed && <MenuNavigation restaurantId={restaurantId} />}{children}</>;
}
