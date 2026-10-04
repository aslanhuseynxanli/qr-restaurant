"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import QRCode from "qrcode";
import { publicOrigin, tableMenuPath } from "@/lib/qr-url";

type Table = { id: string; name: string; table_number: number; qr_token: string; is_active: boolean };
const subscribe = () => () => {};
const getOrigin = () => window.location.origin;
const serverOrigin = () => "";

function QRCard({ table, slug, origin }: { table: Table; slug: string; origin: string | null }) {
  const path = tableMenuPath(slug, table.qr_token);
  const url = origin ? origin + path : "";
  const [qr, setQR] = useState({ url: "", image: "", error: "" });
  const [copyMessage, setCopyMessage] = useState("");
  useEffect(() => {
    if (!url || !table.is_active) return;
    let cancelled = false;
    void QRCode.toDataURL(url, { width: 800, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((image) => { if (!cancelled) setQR({ url, image, error: "" }); })
      .catch(() => { if (!cancelled) setQR({ url, image: "", error: "QR kod yaradıla bilmədi." }); });
    return () => { cancelled = true; };
  }, [url, table.is_active]);
  const ready = qr.url === url && !!qr.image;
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopyMessage("Keçid kopyalandı."); }
    catch { setCopyMessage("Keçidi aşağıdakı xanadan seçib kopyala."); }
  }
  return <article className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
    <div><h3 className="font-semibold">{table.name}</h3><p className="text-sm text-slate-500">Masa №{table.table_number}{!table.is_active && " · Qeyri-aktiv"}</p></div>
    {table.is_active && url && <div className="flex min-h-56 items-center justify-center rounded-xl border border-slate-100 bg-white">
      {ready ? <Image src={qr.image} alt={`${table.name} üçün QR kod`} width={224} height={224} unoptimized /> : <p className="text-sm text-slate-500">{qr.url === url && qr.error ? qr.error : "QR hazırlanır..."}</p>}
    </div>}
    {url && table.is_active && <>
      <input aria-label={`${table.name} menyu keçidi`} className="w-full rounded-lg border border-slate-200 p-2 text-xs" readOnly value={url} onFocus={(event) => event.target.select()} />
      <div className="flex flex-wrap gap-2 text-sm">
        {ready && <a className="rounded-lg bg-emerald-600 px-3 py-2 text-white" href={qr.image} download={`masa-${table.table_number}-qr.png`}>PNG endir</a>}
        <button type="button" className="rounded-lg border border-slate-300 px-3 py-2" onClick={() => void copy()}>Keçidi kopyala</button>
      </div>
      {copyMessage && <p role="status" className="text-xs text-slate-500">{copyMessage}</p>}
    </>}
    {table.is_active && <Link className="inline-block text-sm text-emerald-700 underline" href={path} target="_blank">Menyunu bu saytda aç</Link>}
  </article>;
}

export default function TableQRList({ tables, slug }: { tables: Table[]; slug: string }) {
  const currentOrigin = useSyncExternalStore(subscribe, getOrigin, serverOrigin);
  const [customOrigin, setCustomOrigin] = useState(process.env.NEXT_PUBLIC_SITE_URL || "");
  const candidate = customOrigin.trim() || currentOrigin;
  const origin = publicOrigin(candidate);
  return <section className="space-y-4">
    <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold">Masalar və QR kodlar</h2>
      <label className="block space-y-1 text-sm"><span>QR üçün saytın yayımlanmış ünvanı</span><input className="w-full rounded-xl border border-slate-300 px-3 py-2" value={customOrigin} onChange={(event) => setCustomOrigin(event.target.value)} placeholder="https://layihenin-adi.vercel.app" type="url" maxLength={500} /></label>
      <p className="text-xs text-slate-500">Yayımlanmış saytda ünvan avtomatik seçilir. Kompüterdə işləyərkən Vercel ünvanını bura yaz.</p>
      {!origin && <p className="text-sm text-amber-700">Telefon üçün QR yaratmağa https:// ilə başlayan Vercel və ya domen ünvanını daxil et.</p>}
    </div>
    {tables.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">Hələ masa yoxdur. İlk masanı əlavə et.</p> : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{tables.map((table) => <QRCard key={table.id} table={table} slug={slug} origin={origin} />)}</div>}
  </section>;
}
