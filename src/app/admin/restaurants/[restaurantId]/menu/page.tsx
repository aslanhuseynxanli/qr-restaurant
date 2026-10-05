import Image from "next/image";
import Link from "next/link";
import { requireMenuAdmin } from "@/lib/menu-admin";
import type { MenuCategory, MenuProduct } from "@/lib/menu-management";
import { CategoryForm, ProductForm } from "./forms";

export default async function MenuAdminPage({ params }: { params: Promise<{ restaurantId: string }> }) {
  const { restaurantId } = await params;
  const { supabase, restaurant, canManage } = await requireMenuAdmin(restaurantId);
  const [categoryResult, productResult, branchResult] = await Promise.all([
    supabase.from("categories").select("id,name,description,sort_order,is_active,updated_at").eq("restaurant_id", restaurantId).order("sort_order").order("name").order("id"),
    supabase.from("products").select("id,category_id,name,description,base_price,image_url,sort_order,is_active,updated_at").eq("restaurant_id", restaurantId).order("sort_order").order("name").order("id"),
    supabase.from("branches").select("id,name,is_active").eq("restaurant_id", restaurantId).order("name"),
  ]);
  if ([categoryResult, productResult, branchResult].some((result) => result.error)) throw new Error("Menyu məlumatları yüklənmədi.");
  const categories = (categoryResult.data || []) as MenuCategory[];
  const products = (productResult.data || []) as MenuProduct[];
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href={`/admin/restaurants/${restaurantId}`} className="text-sm text-emerald-700 hover:underline">← {restaurant.name}</Link>
    <header><h1 className="text-2xl font-semibold">Restoran menyusu</h1><p className="mt-2 text-sm text-slate-600">Kateqoriya və məhsullar bütün filiallar üçün ortaqdır. Filial üzrə qiymət və mövcudluğu ayrıca dəyişə bilərsən.</p></header>
    {!canManage && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">Restoran aktiv olmadığından menyuda dəyişiklik etmək mümkün deyil.</p>}
    {canManage && <div className="grid items-start gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Kateqoriya əlavə et</h2><CategoryForm key={`new-category-${categories.length}`} restaurantId={restaurantId} /></section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="mb-4 text-lg font-semibold">Məhsul əlavə et</h2>{categories.length ? <ProductForm key={`new-product-${products.length}`} restaurantId={restaurantId} categories={categories} /> : <p className="text-sm text-slate-500">Əvvəl bir kateqoriya yarat, sonra həmin kateqoriyaya məhsul əlavə et.</p>}</section>
    </div>}
    <section className="space-y-4"><h2 className="text-lg font-semibold">Kateqoriyalar və məhsullar</h2>
      {!categories.length && <p className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Hələ kateqoriya yoxdur.</p>}
      {categories.map((category) => <div key={category.id} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-lg font-semibold">{category.name} {!category.is_active && <span className="ml-2 text-xs font-normal text-amber-700">Aktiv deyil</span>}</h3>{category.description && <p className="mt-1 text-sm text-slate-500">{category.description}</p>}</div></div>
        {canManage && <details className="rounded-xl bg-slate-50 p-3"><summary className="cursor-pointer text-sm font-medium text-emerald-700">Kateqoriyanı redaktə et</summary><div className="mt-4 max-w-xl"><CategoryForm key={category.updated_at} restaurantId={restaurantId} category={category} /><p className="mt-3 text-xs text-slate-500">Kateqoriyanı deaktiv etsən, onun məhsulları QR menyuda görünməyəcək.</p></div></details>}
        {!products.some((product) => product.category_id === category.id) && <p className="text-sm text-slate-500">Bu kateqoriyada hələ məhsul yoxdur.</p>}
        <div className="grid items-start gap-4 md:grid-cols-2">{products.filter((product) => product.category_id === category.id).map((product) => <article key={product.id} className="rounded-xl border border-slate-200 p-4">
          <div className="flex gap-3">{product.image_url && <Image unoptimized src={product.image_url} width={88} height={88} alt={product.name} className="h-22 w-22 shrink-0 rounded-xl object-cover" />}<div className="min-w-0"><h4 className="font-medium">{product.name}</h4><p className="mt-1 font-medium text-emerald-700">{Number(product.base_price).toFixed(2)} AZN</p>{!product.is_active && <p className="mt-1 text-xs text-amber-700">Aktiv deyil</p>}{product.description && <p className="mt-2 whitespace-pre-line text-sm text-slate-500">{product.description}</p>}</div></div>
          {canManage && <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-emerald-700">Məhsulu redaktə et</summary><div className="mt-4"><ProductForm key={product.updated_at} restaurantId={restaurantId} categories={categories} product={product} /></div></details>}
        </article>)}</div>
      </div>)}
    </section>
    {!!branchResult.data?.length && <section className="rounded-2xl border border-slate-200 bg-white p-5"><h2 className="font-semibold">Filial menyuları</h2><div className="mt-3 flex flex-wrap gap-3">{branchResult.data.map((branch) => <Link key={branch.id} href={`/admin/restaurants/${restaurantId}/branches/${branch.id}/menu`} className="rounded-xl border border-emerald-200 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-50">{branch.name}{!branch.is_active ? " (aktiv deyil)" : ""}</Link>)}</div></section>}
  </div></main>;
}
