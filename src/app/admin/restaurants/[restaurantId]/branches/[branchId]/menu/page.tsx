import { loadMenuCategories, loadMenuProducts, loadBranchProductSettings } from "@/lib/menu-query";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMenuAdmin } from "@/lib/menu-admin";
import { uuidPattern, type BranchProduct, type MenuCategory, type MenuProduct } from "@/lib/menu-management";
import BranchProductForm from "./form";

export default async function BranchMenuPage({ params }: { params: Promise<{ restaurantId: string; branchId: string }> }) {
  const { restaurantId, branchId } = await params;
  if (!uuidPattern.test(branchId)) notFound();
  const { supabase, restaurant, canManage } = await requireMenuAdmin(restaurantId);
  const [branchResult, categoryResult, productResult, settingResult] = await Promise.all([
    supabase.from("branches").select("id,name,is_active").eq("id", branchId).eq("restaurant_id", restaurantId).maybeSingle(),
    loadMenuCategories(supabase, restaurantId),
    loadMenuProducts(supabase, restaurantId),
    loadBranchProductSettings(supabase, restaurantId, branchId),
  ]);
  if ([branchResult, categoryResult, productResult, settingResult].some((result) => result.error)) throw new Error("Filial menyusu yüklənmədi.");
  const branch = branchResult.data;
  if (!branch) notFound();
  const categories = (categoryResult.data || []) as MenuCategory[], products = (productResult.data || []) as MenuProduct[];
  const settings = new Map(((settingResult.data || []) as BranchProduct[]).map((setting) => [setting.product_id, setting]));
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-5xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}/branches/${branchId}`} className="text-sm text-emerald-700 hover:underline">← {branch.name}</Link>
    <header><h1 className="text-2xl font-semibold">{branch.name} — filial menyusu</h1><p className="mt-2 text-sm text-slate-600">Buradakı qiymət və mövcudluq dəyişiklikləri yalnız bu filiala aiddir.</p><Link href={`/admin/restaurants/${restaurantId}/menu`} className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:underline">{restaurant.name}: kateqoriya və məhsul əlavə et →</Link></header>
    {(!canManage || !branch.is_active) && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Restoran və ya filial aktiv olmadığından dəyişiklik etmək mümkün deyil.</p>}
    {!products.length && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Əvvəl restoran menyusuna məhsul əlavə et.</p>}
    {categories.filter((category) => products.some((product) => product.category_id === category.id)).map((category) => <section key={category.id} className="space-y-3"><h2 className="text-lg font-semibold">{category.name}{!category.is_active && <span className="ml-2 text-xs font-normal text-amber-700">Kateqoriya aktiv deyil</span>}</h2><div className="grid items-start gap-4 sm:grid-cols-2">{products.filter((product) => product.category_id === category.id).map((product) => {
      const setting = settings.get(product.id);
      return <article key={product.id} className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex gap-3">{product.image_url && <Image unoptimized src={product.image_url} width={72} height={72} alt={product.name} className="h-18 w-18 rounded-xl object-cover" />}<div><h3 className="font-medium">{product.name}</h3><p className="mt-1 text-sm text-slate-500">Ortaq qiymət: {Number(product.base_price).toFixed(2)} AZN</p><p className="mt-1 font-medium text-emerald-700">Filial qiyməti: {Number(setting?.price_override ?? product.base_price).toFixed(2)} AZN</p></div></div>
        {(!product.is_active || !category.is_active) && <p className="mt-3 text-xs text-amber-700">Məhsul və ya kateqoriya deaktiv olduğu üçün QR menyuda görünmür.</p>}
        {setting?.is_visible === false && <p className="mt-2 text-xs text-amber-700">Bu filialın menyusunda gizlidir.</p>}
        {setting?.is_available === false && <p className="mt-2 text-xs text-amber-700">Hazırda bu filialda mövcud deyil.</p>}
        {canManage && branch.is_active && <BranchProductForm key={`${product.updated_at}:${setting?.updated_at || "default"}`} restaurantId={restaurantId} branchId={branchId} product={product} setting={setting} />}
      </article>;
    })}</div></section>)}
  </div></main>;
}
