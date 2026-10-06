import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BranchLocationForm, TableForm } from "./forms";
import TableQRList from "./table-qr";

export default async function BranchPage({ params }: { params: Promise<{ restaurantId: string; branchId: string }> }) {
  const { restaurantId, branchId } = await params;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(restaurantId) || !uuid.test(branchId)) notFound();
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) redirect("/login");
  const [restaurantResult, branchResult, tablesResult, profileResult, platformResult, memberResult] = await Promise.all([
    supabase.from("restaurants").select("id,name,slug,status,is_active").eq("id", restaurantId).maybeSingle(),
    supabase.from("branches").select("id,name,address,latitude,longitude,allowed_radius_meters,accepting_orders,is_active").eq("id", branchId).eq("restaurant_id", restaurantId).maybeSingle(),
    supabase.from("tables").select("id,name,table_number,qr_token,is_active").eq("restaurant_id", restaurantId).eq("branch_id", branchId).order("table_number"),
    supabase.from("profiles").select("is_active").eq("id", auth.user.id).maybeSingle(),
    supabase.from("platform_admins").select("role").eq("user_id", auth.user.id).eq("is_active", true).maybeSingle(),
    supabase.from("restaurant_members").select("role").eq("user_id", auth.user.id).eq("restaurant_id", restaurantId).eq("is_active", true).eq("role", "RESTAURANT_ADMIN").maybeSingle(),
  ]);
  if ([restaurantResult, branchResult, tablesResult, profileResult, platformResult, memberResult].some((result) => result.error)) throw new Error("Filial məlumatları yüklənmədi.");
  const restaurant = restaurantResult.data;
  const branch = branchResult.data;
  if (!restaurant || !branch) notFound();
  const canManage = profileResult.data?.is_active === true && (platformResult.data?.role === "SUPER_ADMIN" || memberResult.data?.role === "RESTAURANT_ADMIN") && restaurant.is_active && ["trial", "active"].includes(restaurant.status);
  const tables = tablesResult.data || [];
  const maxNumber = Math.max(0, ...tables.map((table) => table.table_number));
  const suggestedNumber = maxNumber < 2147483647 ? maxNumber + 1 : 1;

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8">
    <div className="mx-auto max-w-6xl space-y-6">
      <Link href={`/admin/restaurants/${restaurantId}`} className="text-sm text-emerald-700 hover:underline">← {restaurant.name}</Link>
      <header><h1 className="text-2xl font-semibold">{branch.name}</h1><p className="mt-1 text-sm text-slate-500">{branch.address || "Ünvan qeyd edilməyib"} · {branch.accepting_orders && branch.is_active ? "Sifariş qəbulu açıqdır" : "Sifariş qəbulu bağlıdır"}</p></header>
      {/* qr-orders-link-v1 */}
      <Link href={`/admin/restaurants/${restaurantId}/branches/${branchId}/orders`} className="inline-flex min-h-12 items-center rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white">Sifarişlər və çağırışlar</Link>
      <TableQRList tables={tables} slug={restaurant.slug} />
      {canManage && <div className="grid items-start gap-6 lg:grid-cols-2">
        {branch.is_active && <TableForm key={tables.length} restaurantId={restaurantId} branchId={branchId} suggestedNumber={suggestedNumber} />}
        <BranchLocationForm key={`${branch.latitude}:${branch.longitude}:${branch.allowed_radius_meters}:${branch.address}`} restaurantId={restaurantId} branchId={branchId} latitude={Number(branch.latitude)} longitude={Number(branch.longitude)} address={branch.address} radius={branch.allowed_radius_meters} />
      </div>}
    </div>
  </main>;
}
