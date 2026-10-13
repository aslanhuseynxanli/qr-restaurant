import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthShell({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-slate-900"><div className="w-full max-w-md">
    <div className="mb-7 text-center"><Link href="/login" className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-emerald-400 text-xl font-black text-slate-950" aria-label="QR Restoran giriş">QR</Link><p className="text-3xl font-bold text-white">QR Restoran</p><p className="mt-2 text-sm text-slate-400">Restoran idarəetmə paneli</p></div>
    <section className="rounded-3xl bg-white p-6 shadow-xl sm:p-9"><h1 className="text-xl font-semibold">{title}</h1><p className="mb-6 mt-2 text-sm leading-6 text-slate-500">{description}</p>{children}</section>
  </div></main>;
}
