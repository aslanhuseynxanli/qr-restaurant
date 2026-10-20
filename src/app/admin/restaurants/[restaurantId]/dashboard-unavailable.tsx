"use client";
import {useTransition} from "react";
import {useRouter} from "next/navigation";
import {RefreshCw} from "lucide-react";

export default function DashboardUnavailable({error}:{error:string}){
 const router=useRouter(),[pending,startTransition]=useTransition();
 return <section className="portal-panel max-w-xl" aria-busy={pending}><h1 className="text-xl font-bold">Sahib paneli yüklənmədi</h1><p role="alert" className="portal-description">{error}</p><p className="portal-help mt-3">Digər bölmələrə menyudan keçə bilərsən.</p><button type="button" disabled={pending} onClick={()=>startTransition(()=>router.refresh())} className="portal-btn portal-btn-primary mt-5"><RefreshCw size={15} className={pending?"animate-spin":""}/>{pending?"Yoxlanılır…":"Yenidən yoxla"}</button></section>;
}
