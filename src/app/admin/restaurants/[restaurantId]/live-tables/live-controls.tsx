"use client";
import Link from "next/link";
import {formatOwnerTime} from "@/lib/owner-dashboard";
export const liveButton="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-50";
export function LiveControls({generatedAt,now,pending,automatic,onAutomatic,onRefresh}:{generatedAt:string;now:number;pending:boolean;automatic:boolean;onAutomatic:(value:boolean)=>void;onRefresh:()=>void}){
  const overdue=automatic&&now-Date.parse(generatedAt)>30000;
  return <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
    <div className="space-y-1"><p className="text-xs leading-5 text-slate-500">Son yenilənmə: {formatOwnerTime(generatedAt)}</p><p className={`text-xs leading-5 ${overdue?"text-amber-800":"text-slate-500"}`}>{!automatic?"Avtomatik yenilənmə dayandırılıb.":overdue?"Məlumat gecikir. Yenilə düyməsini bas və bağlantını yoxla.":"10 saniyədən bir yenilənir."}</p></div>
    <div className="flex flex-wrap items-center gap-3"><label className="flex min-h-12 cursor-pointer items-center gap-2 text-sm"><input aria-label="Avtomatik yenilə" type="checkbox" checked={automatic} onChange={e=>onAutomatic(e.target.checked)} className="h-5 w-5 accent-emerald-800"/>Avtomatik yenilə</label><button type="button" disabled={pending} onClick={onRefresh} className={liveButton}>{pending?"Yenilənir...":"İndi yenilə"}</button></div>
  </div>;
}
export function LiveDenied({error}:{error:string}){
  return <div role="alert" className="space-y-4 rounded-2xl border border-red-200 bg-white p-6"><p className="text-sm leading-6 text-red-800">{error}</p><Link prefetch={false} href="/admin" className={liveButton}>Hesabını yoxla</Link></div>;
}
