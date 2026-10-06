"use client";
import Link from "next/link";
import {useRef} from "react";
import {useParams,usePathname} from "next/navigation";
import {uuidPattern} from "@/lib/menu-management";
export default function MenuNavigation({restaurantId}:{restaurantId:string}) {
  const pathname=usePathname(),params=useParams(),mobile=useRef<HTMLDetailsElement>(null);
  const branchId=typeof params.branchId==="string"&&uuidPattern.test(params.branchId)?params.branchId:null;
  const root=`/admin/restaurants/${restaurantId}`;
  const links=[{href:root,label:"Ümumi baxış"},{href:`${root}/branches`,label:"Filiallar"},{href:`${root}/live-tables`,label:"Canlı masalar"},{href:`${root}/menu`,label:"Restoran menyusu"},{href:`${root}/staff`,label:"İşçilər"},{href:`${root}/reports`,label:"Satış hesabatları"},{href:`${root}/accounts`,label:"Hesab tarixçəsi"},{href:`${root}/activity`,label:"Fəaliyyət tarixçəsi"}];
  if(branchId)links.push({href:`${root}/branches/${branchId}`,label:"Masalar və QR"},{href:`${root}/branches/${branchId}/menu`,label:"Filial menyusu"},{href:`${root}/branches/${branchId}/orders`,label:"Sifarişlər və çağırışlar"});
  const isCurrent=(href:string)=>pathname===href||href===`${root}/live-tables`&&pathname.startsWith(href+"/");
  const current=links.find(link=>isCurrent(link.href))?.label||"Restoran bölmələri";
  const items=links.map(link=><Link prefetch={link.href===`${root}/live-tables`?false:undefined} key={link.href} href={link.href} aria-current={isCurrent(link.href)?"page":undefined} onClick={()=>{if(mobile.current)mobile.current.open=false;}} className={`flex min-h-11 items-center rounded-xl px-3 py-3 text-sm font-medium ${isCurrent(link.href)?"bg-emerald-800 text-white":"text-emerald-800 hover:bg-emerald-50"}`}>{link.label}</Link>);
  return <nav aria-label="Restoran bölmələri" className="border-b border-emerald-200 bg-white px-4 py-3 sm:px-8"><div className="mx-auto max-w-6xl"><details ref={mobile} className="sm:hidden"><summary className="min-h-11 cursor-pointer rounded-xl bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900">Bölmələr · {current}</summary><div className="grid grid-cols-2 gap-2 pt-3">{items}</div></details><div className="hidden flex-wrap gap-2 sm:flex">{items}</div></div></nav>;
}
