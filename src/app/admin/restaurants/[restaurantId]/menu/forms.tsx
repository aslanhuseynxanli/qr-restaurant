"use client";

import Image from "next/image";
import { useActionState, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseMenuPrice, type MenuActionState, type MenuCategory, type MenuProduct } from "@/lib/menu-management";
import { saveCategoryAction, saveProductAction } from "./actions";

const inputClass = "mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm";
const buttonClass = "rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50";

export function CategoryForm({ restaurantId, category }: { restaurantId: string; category?: MenuCategory }) {
  const [state, action, pending] = useActionState(saveCategoryAction, { error: "" });
  return <form action={action} className="space-y-4">
    <input type="hidden" name="restaurant_id" value={restaurantId} />
    <input type="hidden" name="category_id" value={category?.id || ""} />
    <label className="block text-sm font-medium">Kateqoriya adı<input className={inputClass} name="name" required maxLength={150} defaultValue={category?.name} placeholder="Məsələn: İçkilər" /></label>
    <label className="block text-sm font-medium">Təsvir <span className="font-normal text-slate-500">(istəyə görə)</span><textarea className={inputClass} name="description" maxLength={2000} rows={2} defaultValue={category?.description || ""} /></label>
    <label className="block text-sm font-medium">Menyudakı sıra<input className={inputClass} name="sort_order" type="number" min={0} max={2147483647} step={1} required defaultValue={category?.sort_order ?? 0} /><span className="mt-1 block text-xs font-normal text-slate-500">Kiçik rəqəm daha əvvəl göstərilir.</span></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={category?.is_active ?? true} className="accent-emerald-600" />Kateqoriya aktivdir</label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className={buttonClass}>{pending ? "Yadda saxlanılır..." : category ? "Dəyişiklikləri yadda saxla" : "Kateqoriya əlavə et"}</button>
  </form>;
}

export function ProductForm({ restaurantId, categories, product }: { restaurantId: string; categories: MenuCategory[]; product?: MenuProduct }) {
  const uploaded = useRef<{ file: File; url: string } | null>(null);
  const [state, action, pending] = useActionState(async (previous: MenuActionState, form: FormData) => {
    if (parseMenuPrice(String(form.get("base_price") || "")) === null) return { error: "Qiyməti 5 və ya 5,50 kimi yaz." };
    const file = form.get("image_file");
    let image = form.get("remove_image") === "on" ? "" : product?.image_url || "";
    if (file instanceof File && file.size > 0) {
      const extension: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
      if (!extension[file.type] || file.size > 5 * 1024 * 1024) return { error: "JPG, PNG və ya WebP şəkli seç. Ölçü 5 MB-dan böyük olmamalıdır." };
      try {
        if (uploaded.current?.file === file) image = uploaded.current.url;
        else {
          const supabase = createClient();
          const path = `${restaurantId.toLowerCase()}/${crypto.randomUUID()}.${extension[file.type]}`;
          const { error } = await supabase.storage.from("menu-images").upload(path, file, { upsert: false, contentType: file.type, cacheControl: "31536000" });
          if (error) return { error: "Şəkil yüklənmədi. Hesabını, interneti və 011 SQL faylının işlədildiyini yoxla." };
          image = supabase.storage.from("menu-images").getPublicUrl(path).data.publicUrl;
          uploaded.current = { file, url: image };
        }
      } catch { return { error: "Şəkil yüklənmədi. Yenidən cəhd et." }; }
    }
    form.delete("image_file");
    form.set("image_url", image);
    return saveProductAction(previous, form);
  }, { error: "" });
  return <form action={action} className="space-y-4">
    <input type="hidden" name="restaurant_id" value={restaurantId} />
    <input type="hidden" name="product_id" value={product?.id || ""} />
    <label className="block text-sm font-medium">Məhsul adı<input className={inputClass} name="name" required maxLength={150} defaultValue={product?.name} placeholder="Məsələn: Limonad" /></label>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">Kateqoriya<select aria-label="Kateqoriya" className={inputClass} name="category_id" required defaultValue={product?.category_id || ""}><option value="" disabled>Kateqoriya seç</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}{!category.is_active ? " (aktiv deyil)" : ""}</option>)}</select></label>
      <label className="block text-sm font-medium">Qiymət (AZN)<input className={inputClass} name="base_price" inputMode="decimal" required maxLength={11} defaultValue={product ? Number(product.base_price).toFixed(2) : ""} placeholder="5,50" /></label>
    </div>
    <label className="block text-sm font-medium">Təsvir <span className="font-normal text-slate-500">(istəyə görə)</span><textarea className={inputClass} name="description" maxLength={2000} rows={3} defaultValue={product?.description || ""} placeholder="Məhsulun tərkibi və qısa təsviri" /></label>
    <div className="space-y-2">
      {product?.image_url && <><Image unoptimized src={product.image_url} width={160} height={120} alt={product.name} className="h-28 w-40 rounded-xl object-cover" /><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="remove_image" className="accent-emerald-600" />Hazırkı şəkli sil</label></>}
      <label className="block text-sm font-medium">{product?.image_url ? "Yeni şəkil seç" : "Məhsul şəkli"}<input className={`${inputClass} file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-emerald-700`} name="image_file" type="file" accept="image/jpeg,image/png,image/webp" /></label>
      <p className="text-xs text-slate-500">İstəyə görə. JPG, PNG və ya WebP, ən çox 5 MB.</p>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-medium">Menyudakı sıra<input className={inputClass} name="sort_order" type="number" min={0} max={2147483647} step={1} required defaultValue={product?.sort_order ?? 0} /></label>
      <label className="flex items-center gap-2 pt-6 text-sm"><input type="checkbox" name="is_active" defaultChecked={product?.is_active ?? true} className="accent-emerald-600" />Məhsul aktivdir</label>
    </div>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending || categories.length === 0} className={buttonClass}>{pending ? "Şəkil və məhsul yadda saxlanılır..." : product ? "Dəyişiklikləri yadda saxla" : "Məhsul əlavə et"}</button>
  </form>;
}
