import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import BranchForm from "./branch-form";

export default async function RestaurantPage({
  params,
}: {
  params: Promise<{ restaurantId: string }>;
}) {
  const { restaurantId } = await params;

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      restaurantId,
    )
  ) {
    notFound();
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) redirect("/login");

  const [
    restaurantResult,
    branchesResult,
    adminResult,
    memberResult,
  ] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id,name,slug,status,is_active")
      .eq("id", restaurantId)
      .maybeSingle(),

    supabase
      .from("branches")
      .select(
        "id,name,address,latitude,longitude,allowed_radius_meters,accepting_orders,is_active",
      )
      .eq("restaurant_id", restaurantId)
      .order("created_at", { ascending: false }),

    supabase
      .from("platform_admins")
      .select("role")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .maybeSingle(),

    supabase
      .from("restaurant_members")
      .select("role")
      .eq("user_id", user.id)
      .eq("restaurant_id", restaurantId)
      .eq("role", "RESTAURANT_ADMIN")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (
    restaurantResult.error || branchesResult.error ||
    adminResult.error || memberResult.error
  ) {
    throw new Error("Restoran məlumatları yüklənmədi.");
  }

  const restaurant = restaurantResult.data;

  if (!restaurant) notFound();

  const branches = branchesResult.data ?? [];

  const canCreate =
    restaurant.is_active &&
    ["active", "trial"].includes(restaurant.status) &&
    (
      adminResult.data?.role === "SUPER_ADMIN" ||
      memberResult.data?.role === "RESTAURANT_ADMIN"
    );

  return (
    <main className="min-h-screen bg-slate-50 px-5 py-8 text-slate-900">
      <div className="mx-auto max-w-5xl">
        <Link href="/admin" className="text-sm font-medium text-slate-600">
          ← Panelə qayıt
        </Link>

        <h1 className="mt-6 text-2xl font-bold">{restaurant.name}</h1>
        <p className="mt-2 text-sm text-slate-500">{restaurant.slug}</p>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="mb-5 text-lg font-semibold">
              Filiallar ({branches.length})
            </h2>

            {branches.length === 0 ? (
              <p className="text-sm text-slate-500">
                Hələ filial əlavə edilməyib.
              </p>
            ) : (
              <div className="space-y-4">
                {branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="rounded-xl border border-slate-200 p-4"
                  >
                    <p className="font-semibold"><Link href={`/admin/restaurants/${restaurant.id}/branches/${branch.id}`} className="text-emerald-700 hover:underline">{branch.name}</Link></p>

                    {branch.address && (
                      <p className="mt-1 text-sm text-slate-500">
                        {branch.address}
                      </p>
                    )}

                    <p className="mt-3 text-xs text-slate-500">
                      Koordinatlar: {branch.latitude}, {branch.longitude}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      Radius: {branch.allowed_radius_meters} metr
                    </p>

                    <span className="mt-3 inline-block rounded-lg bg-slate-100 px-3 py-1 text-xs">
                      {!branch.is_active
                        ? "Deaktiv"
                        : branch.accepting_orders
                          ? "Sifariş qəbul edir"
                          : "Sifariş qəbulu bağlıdır"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {canCreate && (
            <BranchForm
              key={branches.length}
              restaurantId={restaurant.id}
            />
          )}
        </div>
      </div>
    </main>
  );
}