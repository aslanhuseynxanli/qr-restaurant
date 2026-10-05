"use client";

import { useActionState } from "react";
import type { BranchProduct, MenuProduct } from "@/lib/menu-management";
import { saveBranchProductAction } from "./actions";

export default function BranchProductForm({ restaurantId, branchId, product, setting }: { restaurantId: string; branchId: string; product: MenuProduct; setting?: BranchProduct }) {
  const [state, action, pending] = useActionState(saveBranchProductAction, { error: "" });
  return <form action={action} className="mt-4 space-y-3 border-t border-slate-100 pt-4">
    <input type="hidden" name="restaurant_id" value={restaurantId} /><input type="hidden" name="branch_id" value={branchId} /><input type="hidden" name="product_id" value={product.id} />
    <label className="block text-sm font-medium">Bu filialın qiyməti (AZN)<input name="price_override" inputMode="decimal" maxLength={11} placeholder={Number(product.base_price).toFixed(2)} defaultValue={setting?.price_override == null ? "" : Number(setting.price_override).toFixed(2)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2.5" /><span className="mt-1 block text-xs font-normal text-slate-500">Boş saxlasan, restoranın ortaq qiyməti istifadə ediləcək.</span></label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_visible" defaultChecked={setting?.is_visible ?? true} className="accent-emerald-600" />Bu filialın menyusunda görünsün</label>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_available" defaultChecked={setting?.is_available ?? true} className="accent-emerald-600" />Bu filialda mövcuddur</label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50">{pending ? "Yadda saxlanılır..." : "Yadda saxla"}</button>
  </form>;
}
