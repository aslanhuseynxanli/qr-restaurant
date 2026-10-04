"use client";

import { useActionState, useCallback, useState } from "react";
import LocationPicker, { type Position } from "@/components/location-picker";
import { createTableAction, updateLocationAction } from "./actions";
const inputClass = "w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500";

export function TableForm({ restaurantId, branchId, suggestedNumber }: { restaurantId: string; branchId: string; suggestedNumber: number }) {
  const [state, action, pending] = useActionState(createTableAction, { error: "" });
  return <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Masa əlavə et</h2>
    <input type="hidden" name="restaurant_id" value={restaurantId} /><input type="hidden" name="branch_id" value={branchId} />
    <label className="block space-y-1 text-sm"><span>Masa nömrəsi</span><input className={inputClass} type="number" name="table_number" min={1} max={2147483647} step={1} required defaultValue={suggestedNumber} /></label>
    <label className="block space-y-1 text-sm"><span>Masa adı (istəyə bağlı)</span><input className={inputClass} name="name" maxLength={150} placeholder={`Masa ${suggestedNumber}`} /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-white disabled:opacity-50">{pending ? "Yaradılır..." : "Masa və QR yarat"}</button>
  </form>;
}

export function BranchLocationForm({ restaurantId, branchId, latitude, longitude, address: initialAddress, radius: initialRadius }: {
  restaurantId: string; branchId: string; latitude: number; longitude: number; address: string | null; radius: number;
}) {
  const [state, action, pending] = useActionState(updateLocationAction, { error: "" });
  const [position, setPosition] = useState<Position>({ latitude, longitude });
  const [address, setAddress] = useState(initialAddress || "");
  const [radius, setRadius] = useState(String(initialRadius));
  const selectPosition = useCallback((next: Position) => setPosition(next), []);
  return <form action={action} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <h2 className="text-lg font-semibold">Filialın yeri</h2>
    <input type="hidden" name="restaurant_id" value={restaurantId} /><input type="hidden" name="branch_id" value={branchId} />
    <input type="hidden" name="latitude" value={position.latitude.toFixed(6)} /><input type="hidden" name="longitude" value={position.longitude.toFixed(6)} />
    <LocationPicker value={position} radius={Math.max(1, Number(radius) || 150)} onChange={selectPosition} onAddressSelect={setAddress} />
    <label className="block space-y-1 text-sm"><span>Ünvan</span><input className={inputClass} name="address" maxLength={500} value={address} onChange={(event) => setAddress(event.target.value)} /></label>
    <label className="block space-y-1 text-sm"><span>Sifariş radiusu (metr)</span><input className={inputClass} type="number" name="radius" min={1} max={2147483647} step={1} required value={radius} onChange={(event) => setRadius(event.target.value)} /></label>
    {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
    <button disabled={pending} className="w-full rounded-xl bg-emerald-600 px-4 py-3 text-white disabled:opacity-50">{pending ? "Saxlanılır..." : "Yeri yadda saxla"}</button>
  </form>;
}
