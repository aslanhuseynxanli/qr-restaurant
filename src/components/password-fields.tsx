"use client";
import { useState } from "react";

export const authInput = "w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base outline-none focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100 disabled:opacity-60";
export const authButton = "min-h-12 w-full rounded-xl bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:cursor-wait disabled:opacity-60";

export default function PasswordFields({ pending, current = false }: { pending: boolean; current?: boolean }) {
  const [show, setShow] = useState(false);
  return <>
    {current && <div><label htmlFor="currentPassword" className="mb-2 block text-sm font-medium">Hazırkı şifrə</label><input id="currentPassword" name="currentPassword" type={show ? "text" : "password"} autoComplete="current-password" required maxLength={1024} disabled={pending} className={authInput}/></div>}
    <div><label htmlFor="password" className="mb-2 block text-sm font-medium">Yeni şifrə</label><input id="password" name="password" type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128} disabled={pending} aria-describedby="password-help" className={authInput}/><p id="password-help" className="mt-2 text-xs leading-5 text-slate-500">10–128 simvol, ən az bir hərf və bir rəqəm.</p></div>
    <div><label htmlFor="confirmation" className="mb-2 block text-sm font-medium">Yeni şifrəni təkrar yaz</label><input id="confirmation" name="confirmation" type={show ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128} disabled={pending} className={authInput}/></div>
    <button type="button" onClick={() => setShow(!show)} disabled={pending} aria-pressed={show} className="min-h-11 text-sm font-medium text-slate-600">{show ? "Şifrələri gizlət" : "Şifrələri göstər"}</button>
  </>;
}
