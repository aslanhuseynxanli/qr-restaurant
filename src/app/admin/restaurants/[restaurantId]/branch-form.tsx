"use client";

import { useActionState, useCallback, useState } from "react";
import LocationPicker, { type Position } from "@/components/location-picker";
import { createBranchAction } from "./actions";

export default function BranchForm({ restaurantId }: { restaurantId: string }) {
  const [state, action, pending] = useActionState(createBranchAction, { error: "" });
  const [position, setPosition] = useState<Position | null>(null);
  const [address, setAddress] = useState("");
  const [radius, setRadius] = useState("150");
  const selectPosition = useCallback((next: Position) => setPosition(next), []);
  const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500";

  return <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <h2 className="text-lg font-semibold">Filial əlavə et</h2>
    <input type="hidden" name="restaurant_id" value={restaurantId} />
    <input type="hidden" name="latitude" value={position?.latitude.toFixed(6) ?? ""} />
    <input type="hidden" name="longitude" value={position?.longitude.toFixed(6) ?? ""} />
    <label className="block space-y-1 text-sm"><span>Filialın adı</span><input name="name" required maxLength={150} className={inputClass} placeholder="Mərkəz filialı" /></label>
    <LocationPicker value={position} radius={Math.max(1, Number(radius) || 150)} onChange={selectPosition} onAddressSelect={setAddress} />
    <label className="block space-y-1 text-sm"><span>Ünvan</span><input name="address" value={address} onChange={(event) => setAddress(event.target.value)} maxLength={500} className={inputClass} /></label>
    <label className="block space-y-1 text-sm"><span>Telefon</span><input name="phone" type="tel" maxLength={30} className={inputClass} /></label>
    <label className="block space-y-1 text-sm"><span>Sifariş radiusu (metr)</span><input name="radius" type="number" required min={1} max={2147483647} step={1} value={radius} onChange={(event) => setRadius(event.target.value)} className={inputClass} /></label>
    <label className="flex items-center gap-2 text-sm"><input name="accepting_orders" type="checkbox" className="accent-emerald-600" />Filial sifariş qəbul etsin</label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending || !position} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white disabled:opacity-50">{pending ? "Yaradılır..." : "Filial yarat"}</button>
  </form>;
}
