"use client";
export default function MenuError({ reset }: { reset: () => void }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900"><div className="max-w-sm space-y-4 rounded-2xl bg-white p-6 text-center shadow-sm"><h1 className="text-xl font-semibold">Menyu yüklənmədi</h1><p className="text-sm text-slate-600">İnternet bağlantısını yoxla və yenidən cəhd et.</p><button onClick={reset} className="rounded-xl bg-emerald-600 px-4 py-3 text-white">Yenidən yoxla</button></div></main>;
}
