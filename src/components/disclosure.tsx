"use client";
import {useState,type ReactNode} from "react";
import {ChevronDown} from "lucide-react";
export default function Disclosure({title,defaultOpen=false,children}:{title:string;defaultOpen?:boolean;children:ReactNode}){const [open,setOpen]=useState(defaultOpen);return <section className="rounded-2xl border border-slate-200 bg-white p-5"><button type="button" aria-expanded={open} onClick={()=>setOpen(!open)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left font-semibold"><span>{title}</span><ChevronDown size={18} className={open?"rotate-180":""}/></button>{open&&<div className="pt-4">{children}</div>}</section>;}
