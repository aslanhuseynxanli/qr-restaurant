import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/login/actions";
import Link from "next/link";

export default async function AdminPage() {
    const supabase = await createClient();

    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) redirect("/login");

    const [profileResult, adminResult, membersResult] = await Promise.all([
        supabase
            .from("profiles")
            .select("full_name,is_active")
            .eq("id", user.id)
            .maybeSingle(),

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
            .eq("is_active", true),
    ]);

    if (
        profileResult.error ||
        adminResult.error ||
        membersResult.error
    ) {
        throw new Error("Hesab icazələri oxunmadı. Yenidən cəhd et.");
    }

    const profile = profileResult.data;
    const memberships = membersResult.data ?? [];

    const role = !profile?.is_active
        ? null
        : adminResult.data?.role === "SUPER_ADMIN"
            ? "SUPER_ADMIN"
            : memberships.some((m) => m.role === "RESTAURANT_ADMIN")
                ? "RESTAURANT_ADMIN"
                : memberships.some((m) => m.role === "STAFF")
                    ? "STAFF"
                    : null;

    let restaurants: {
        id: string;
        name: string;
        slug: string;
        status: string;
        is_active: boolean;
    }[] = [];

    if (role) {
        const { data, error } = await supabase
            .from("restaurants")
            .select("id,name,slug,status,is_active")
            .order("created_at", { ascending: false });

        if (error) {
            throw new Error("Restoranlar yüklənmədi. Yenidən cəhd et.");
        }

        restaurants = data ?? [];
    }

    return (
        <main className="min-h-screen bg-slate-50 text-slate-900">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-5">
                    <div>
                        <p className="text-lg font-bold">QR Restoran</p>
                        <p className="text-sm text-slate-500">İdarəetmə paneli</p>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                        {role === "SUPER_ADMIN" && (
                            <Link
                                href="/admin/restaurants/new"
                                className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                            >
                                Restoran əlavə et
                            </Link>
                        )}

                        <form action={signOutAction}>
                            <button className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium hover:bg-slate-50">
                                Çıxış
                            </button>
                        </form>
                    </div>
                </div>
            </header>

            <div className="mx-auto max-w-5xl space-y-6 px-5 py-8">
                <section className="rounded-2xl border border-slate-200 bg-white p-6">
                    <h1 className="text-2xl font-bold">
                        {profile?.full_name || "Xoş gəldin"}
                    </h1>

                    <p className="mt-2 break-all text-sm text-slate-500">
                        {user.email}
                    </p>

                    {role ? (
                        <span className="mt-4 inline-block rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                            {role}
                        </span>
                    ) : (
                        <p role="alert" className="mt-4 text-sm text-red-700">
                            {profile?.is_active
                                ? "Bu hesaba idarəetmə rolu təyin edilməyib."
                                : "Bu hesab aktiv deyil. Adminlə əlaqə saxla."}
                        </p>
                    )}
                </section>

                {role && (
                    <section className="rounded-2xl border border-slate-200 bg-white p-6">
                        <div className="mb-5 flex items-center justify-between gap-3">
                            <h2 className="text-lg font-semibold">Restoranlar</h2>

                            <span className="rounded-lg bg-slate-100 px-3 py-1 text-sm">
                                {restaurants.length}
                            </span>
                        </div>

                        {restaurants.length === 0 ? (
                            <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">
                                Hələ restoran əlavə edilməyib.
                            </p>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {restaurants.map((restaurant) => (
                                    <div
                                        key={restaurant.id}
                                        className="flex flex-wrap items-center justify-between gap-3 py-4"
                                    >
                                        <div>
                                            <Link
                                                href={`/admin/restaurants/${restaurant.id}`}
                                                className="font-medium text-emerald-700 hover:underline"
                                            >
                                                {restaurant.name}
                                            </Link>
                                            <p className="text-sm text-slate-500">
                                                {restaurant.slug}
                                            </p>
                                        </div>

                                        <span className="rounded-lg bg-slate-100 px-3 py-1 text-xs">
                                            {!restaurant.is_active
                                                ? "Deaktiv"
                                                : restaurant.status === "active"
                                                    ? "Aktiv"
                                                    : restaurant.status === "trial"
                                                        ? "Sınaq"
                                                        : "Dayandırılıb"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>
                )}
            </div>
        </main>
    );
}