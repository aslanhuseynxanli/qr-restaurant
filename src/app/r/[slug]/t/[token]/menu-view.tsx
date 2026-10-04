"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { QRMenu } from "@/lib/qr-menu";

export default function MenuView({ slug, token, initialMenu }: { slug: string; token: string; initialMenu: QRMenu }) {
  const [menu, setMenu] = useState(initialMenu);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const visible = menu.location.status === "ALLOWED" || menu.location.status === "NOT_REQUIRED";
  function locate() {
    if (!navigator.geolocation) { setMessage("Bu brauzerdə mövqe müəyyən edilmir. Telefonunda başqa brauzerdən aç."); return; }
    setLoading(true); setMessage("");
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("get_qr_menu", { p_slug: slug, p_table_token: token, p_latitude: position.coords.latitude, p_longitude: position.coords.longitude });
        if (error || !data) { setMessage("Menyu yüklənmədi. QR kodu yenidən aç və cəhd et."); return; }
        setMenu(data as QRMenu);
      } catch { setMessage("Bağlantı alınmadı. Yenidən cəhd et."); }
      finally { setLoading(false); }
    }, (error) => {
      setMessage(error.code === 1 ? "Menyu üçün brauzerdə mövqe icazəsini aç, sonra yenidən yoxla." : "Mövqe müəyyən edilmədi. Yenidən cəhd et.");
      setLoading(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="rounded-2xl bg-emerald-700 p-6 text-white"><h1 className="text-2xl font-semibold">{menu.restaurant.name}</h1><p className="mt-2 text-emerald-100">{menu.branch.name} · {menu.table.name}</p>{menu.branch.address && <p className="mt-1 text-sm text-emerald-100">{menu.branch.address}</p>}</header>
      {menu.location.required && <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">{visible ? "Mövqe təsdiqləndi" : "Restoranda olduğunu təsdiqlə"}</h2>
        {menu.location.status === "OUTSIDE" ? <p className="text-sm text-amber-700">Filialdan təxminən {Math.round(menu.location.distance_meters || 0)} m uzaqdasan. Menyu {menu.location.allowed_radius_meters} m radiusda açılır.</p> : <p className="text-sm text-slate-600">{visible ? "Menyunu aşağıda görə bilərsən." : "Menyunu açmaq üçün telefonunun mövqe icazəsini ver."}</p>}
        <button disabled={loading} onClick={locate} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{loading ? "Yoxlanılır..." : visible ? "Mövqeni yenidən yoxla" : "Mövqeni yoxla və menyunu aç"}</button>
        {message && <p role="alert" className="text-sm text-red-700">{message}</p>}
      </section>}
      {!menu.accepting_orders && <p className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Filial hazırda sifariş qəbul etmir.</p>}
      {visible && (menu.categories.length === 0 ? <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">Menyuya hələ məhsul əlavə edilməyib.</div> : menu.categories.map((category) => <section key={category.id} className="space-y-3">
        <h2 className="text-xl font-semibold">{category.name}</h2>{category.description && <p className="text-sm text-slate-600">{category.description}</p>}
        {category.products.map((product) => <article key={product.id} className={`flex justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 ${!product.is_available ? "opacity-60" : ""}`}>
          <div><h3 className="font-medium">{product.name}</h3>{product.description && <p className="mt-1 text-sm text-slate-500">{product.description}</p>}{!product.is_available && <p className="mt-1 text-xs text-amber-700">Hazırda mövcud deyil</p>}</div>
          <p className="whitespace-nowrap font-medium text-emerald-700">{Number(product.price).toFixed(2)} {menu.currency}</p>
        </article>)}
      </section>))}
    </div>
  </main>;
}
