"use client";

import { useEffect, useRef, useState } from "react";
import type { Circle, Map as LeafletMap, Marker } from "leaflet";
import "leaflet/dist/leaflet.css";

export type Position = { latitude: number; longitude: number };
type Place = Position & { label: string };
type MapState = { map: LeafletMap; marker: Marker | null; circle: Circle | null; L: typeof import("leaflet") };
const placesCache = new Map<string, Place[]>();

export default function LocationPicker({ value, radius, onChange, onAddressSelect }: {
  value: Position | null;
  radius: number;
  onChange: (position: Position) => void;
  onAddressSelect?: (address: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<MapState | null>(null);
  const latest = useRef({ value, radius, onChange });
  const controller = useRef<AbortController | null>(null);
  const lastSearch = useRef(0);
  const alive = useRef(true);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState("");
  const [mapError, setMapError] = useState("");

  useEffect(() => { latest.current = { value, radius, onChange }; }, [value, radius, onChange]);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    let observer: ResizeObserver | undefined;
    function draw() {
      const state = instance.current;
      const selected = latest.current.value;
      if (!state || !selected) return;
      const point: [number, number] = [selected.latitude, selected.longitude];
      if (!state.marker) {
        state.marker = state.L.marker(point, {
          draggable: true,
          icon: state.L.divIcon({
            className: "",
            html: '<span style="display:block;width:24px;height:24px;border:4px solid white;border-radius:50%;background:#059669;box-shadow:0 1px 6px #0008"></span>',
            iconSize: [24, 24], iconAnchor: [12, 12],
          }),
        }).addTo(state.map);
        state.marker.on("dragend", () => {
          const position = state.marker!.getLatLng().wrap();
          latest.current.onChange({ latitude: position.lat, longitude: position.lng });
        });
        state.circle = state.L.circle(point, { radius: latest.current.radius, color: "#059669", fillOpacity: 0.12 }).addTo(state.map);
      } else {
        state.marker.setLatLng(point);
        state.circle?.setLatLng(point).setRadius(latest.current.radius);
      }
    }
    void import("leaflet").then((L) => {
      if (cancelled || !container.current) return;
      const selected = latest.current.value;
      const map = L.map(container.current, { worldCopyJump: true, zoomAnimation: false }).setView(
        selected ? [selected.latitude, selected.longitude] : [40.4093, 49.8671], selected ? 17 : 12,
      );
      instance.current = { map, L, marker: null, circle: null };
      L.tileLayer(process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      map.on("click", (event) => {
        latest.current.onChange({ latitude: event.latlng.lat, longitude: event.latlng.wrap().lng });
      });
      draw();
      observer = new ResizeObserver(() => {
        if (!cancelled && instance.current?.map === map) map.invalidateSize({ animate: false });
      });
      observer.observe(container.current);
    }).catch(() => { if (!cancelled) setMapError("Xəritə yüklənmədi. Səhifəni yenilə və ya cari mövqedən istifadə et."); });
    return () => {
      cancelled = true;
      alive.current = false;
      controller.current?.abort();
      observer?.disconnect();
      instance.current?.map.remove();
      instance.current = null;
    };
  }, []);

  useEffect(() => {
    const state = instance.current;
    if (!state || !value) return;
    const point: [number, number] = [value.latitude, value.longitude];
    if (!state.marker) {
      state.marker = state.L.marker(point, {
        draggable: true,
        icon: state.L.divIcon({ className: "", html: '<span style="display:block;width:24px;height:24px;border:4px solid white;border-radius:50%;background:#059669;box-shadow:0 1px 6px #0008"></span>', iconSize: [24, 24], iconAnchor: [12, 12] }),
      }).addTo(state.map);
      state.marker.on("dragend", () => {
        const position = state.marker!.getLatLng().wrap();
        latest.current.onChange({ latitude: position.lat, longitude: position.lng });
      });
      state.circle = state.L.circle(point, { radius, color: "#059669", fillOpacity: 0.12 }).addTo(state.map);
    } else {
      state.marker.setLatLng(point);
      state.circle?.setLatLng(point).setRadius(radius);
    }
    state.map.setView(point, Math.max(state.map.getZoom(), 16), { animate: false });
  }, [value, radius]);

  async function search() {
    const text = query.trim();
    if (text.length < 3 || text.length > 200) { setMessage("Şəhər və ünvanı yaz: məsələn, Bakı, Nizami küçəsi."); return; }
    const key = text.toLocaleLowerCase();
    const cached = placesCache.get(key);
    if (cached) { setPlaces(cached); setMessage(cached.length ? "Nəticələrdən birini seç, sonra xəritədə dəqiqləşdir." : "Ünvan tapılmadı. Xəritədə yeri özün seçə bilərsən."); return; }
    if (searching || Date.now() - lastSearch.current < 1500) return;
    lastSearch.current = Date.now();
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 12000);
    setSearching(true); setMessage(""); setPlaces([]);
    try {
      const url = new URL(process.env.NEXT_PUBLIC_GEOCODER_URL || "https://photon.komoot.io/api/");
      url.searchParams.set("q", text); url.searchParams.set("limit", "5");
      const response = await fetch(url, { signal: abort.signal });
      if (!response.ok) throw new Error("search");
      const data: { features?: { geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[] } = await response.json();
      const results: Place[] = (data.features || []).flatMap((feature) => {
        const coordinates = feature.geometry?.coordinates;
        if (!coordinates || !Number.isFinite(coordinates[0]) || !Number.isFinite(coordinates[1]) || Math.abs(coordinates[0]) > 180 || Math.abs(coordinates[1]) > 90) return [];
        const properties = feature.properties || {};
        const label = [...new Set([properties.name, properties.street, properties.housenumber, properties.city, properties.state, properties.country].filter((part): part is string => typeof part === "string" && part.length > 0))].join(", ");
        return [{ longitude: coordinates[0], latitude: coordinates[1], label: label || text }];
      });
      if (placesCache.size >= 50) placesCache.clear();
      placesCache.set(key, results);
      if (alive.current) { setPlaces(results); setMessage(results.length ? "Nəticəni seç, sonra nişanı filialın girişinə çək." : "Ünvan tapılmadı. Xəritədən seç və ya ünvanı başqa cür yaz."); }
    } catch {
      if (alive.current) setMessage("Ünvan axtarışı alınmadı. Xəritədə yeri seçə və ya yenidən axtara bilərsən.");
    } finally { clearTimeout(timer); if (alive.current) setSearching(false); }
  }

  function locate() {
    if (!navigator.geolocation) { setMessage("Bu brauzerdə mövqe müəyyən edilmir. Xəritədən seç."); return; }
    setLocating(true); setMessage("");
    navigator.geolocation.getCurrentPosition((result) => {
      if (!alive.current) return;
      onChange({ latitude: result.coords.latitude, longitude: result.coords.longitude });
      setMessage(`Mövqe seçildi. Təxmini dəqiqlik: ${Math.round(result.coords.accuracy)} m. Nişanı filialın girişində dəqiqləşdir.`);
      setLocating(false);
    }, (error) => {
      if (!alive.current) return;
      setMessage(error.code === 1 ? "Mövqe icazəsi verilmədi. Ünvanı axtar və ya xəritədən seç." : "Mövqe alınmadı. Ünvanı axtar və ya xəritədən seç.");
      setLocating(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  return <div className="space-y-3">
    <p className="text-sm text-slate-600">Filialın girişini xəritədə seç. Koordinatlar avtomatik qeyd olunur.</p>
    <div className="flex gap-2">
      <input aria-label="Ünvan axtarışı" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Bakı, Nizami küçəsi..." maxLength={200} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void search(); } }} />
      <button type="button" disabled={searching} onClick={() => void search()} className="rounded-xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50">{searching ? "Axtarılır..." : "Axtar"}</button>
    </div>
    {places.length > 0 && <ul className="divide-y overflow-hidden rounded-xl border border-slate-200">{places.map((place, index) => <li key={`${place.latitude}:${place.longitude}:${index}`}><button type="button" className="w-full p-3 text-left text-sm hover:bg-emerald-50" onClick={() => { onChange({ latitude: place.latitude, longitude: place.longitude }); onAddressSelect?.(place.label.slice(0, 500)); setPlaces([]); setMessage("Yeri yoxla və nişanı filialın girişində dəqiqləşdir."); }}>{place.label}</button></li>)}</ul>}
    <div ref={container} className="relative z-0 h-80 w-full rounded-xl border border-slate-200" aria-label="Filialın yerini seçmək üçün xəritə" />
    {mapError && <p role="alert" className="text-sm text-red-700">{mapError}</p>}
    <button type="button" onClick={locate} disabled={locating} className="rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{locating ? "Mövqe alınır..." : "Hazırda olduğum yeri seç"}</button>
    {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    <p className="text-sm text-emerald-700">{value ? `Seçilmiş mövqe: ${value.latitude.toFixed(6)}, ${value.longitude.toFixed(6)}` : "Hələ yer seçilməyib."}</p>
    <p className="text-xs text-slate-500">Ünvan məlumatları: <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> · <a className="underline" href="https://photon.komoot.io" target="_blank" rel="noreferrer">Photon</a></p>
  </div>;
}
