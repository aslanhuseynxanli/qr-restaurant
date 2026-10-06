"use client";
import {useActionState,useEffect,useRef,useState} from "react";
import {useRouter} from "next/navigation";
import type {OwnerActionState,OwnerManagementBoard,OwnerMember} from "@/lib/owner-management";
import {createOwnerAction,updateOwnerAction} from "./actions";

const input="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 disabled:opacity-50";
const button="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-40";
const initial:OwnerActionState={error:""};
function Feedback({state}:{state:OwnerActionState}) {
  return <>{state.error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm leading-6 text-red-800">{state.error}</p>}{state.success&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm leading-6 text-emerald-800">{state.success}</p>}</>;
}
function OwnerRow({restaurantId,member}:{restaurantId:string;member:OwnerMember}) {
  const router=useRouter();
  const [state,action,pending]=useActionState(async(prev:OwnerActionState,form:FormData)=>{
    try{const result=await updateOwnerAction(prev,form);if(result.success)router.refresh();return result;}catch{return {error:"Bağlantı alınmadı. Siyahını yeniləyib hesabın girişini yoxla."};}
  },initial);
  return <form action={action} aria-label={member.email} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
    <input type="hidden" name="restaurant_id" value={restaurantId}/><input type="hidden" name="member_id" value={member.id}/><input type="hidden" name="version" value={member.version}/>
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words font-semibold">{member.full_name||"Restoran sahibi"}</h3><p className="mt-1 break-all text-sm text-slate-500">{member.email}</p></div><span className={`rounded-full px-3 py-1.5 text-xs font-medium ${member.is_active&&member.profile_active?"bg-emerald-50 text-emerald-800":"bg-slate-100 text-slate-600"}`}>{member.is_active&&member.profile_active?"Aktiv":"Deaktiv"}</span></div>
    {!member.profile_active&&<p className="text-xs leading-5 text-amber-800">İstifadəçi profili platforma üzrə deaktivdir. Burada girişin aktiv edilməsi profil məhdudiyyətini dəyişmir.</p>}
    <label className="block space-y-2 text-sm font-medium"><span>Bu restorana giriş</span><select name="is_active" aria-label="Bu restorana giriş" defaultValue={String(member.is_active)} disabled={pending} className={input}><option value="true">Aktiv</option><option value="false">Deaktiv</option></select></label>
    <button disabled={pending} className={button}>{pending?"Yadda saxlanır...":"Yadda saxla"}</button><Feedback state={state}/>
  </form>;
}
export default function OwnerPanel({restaurantId,board}:{restaurantId:string;board:OwnerManagementBoard}) {
  const router=useRouter(),request=useRef<string|null>(null);
  const [showPassword,setShowPassword]=useState(false),[search,setSearch]=useState("");
  const [details,setDetails]=useState({full_name:"",email:"",password:""});
  const [state,action,pending]=useActionState(async(prev:OwnerActionState,form:FormData)=>{
    request.current??=crypto.randomUUID();form.set("request_id",request.current);
    try {
      const result=await createOwnerAction(prev,form);
      if(result.success){request.current=null;setDetails({full_name:"",email:"",password:""});setShowPassword(false);router.refresh();}
      else if(!result.retryable)request.current=null;
      return result;
    }catch{return {error:"Yaratmanın nəticəsi alınmadı. Eyni məlumatlarla yenidən göndər və ya səhifəni yeniləyib siyahını yoxla.",retryable:true};}
  },initial);
  useEffect(()=>{
    const timer=setInterval(()=>{if(document.visibilityState==="visible"&&!pending)router.refresh();},15000);
    return()=>clearInterval(timer);
  },[router,pending]);
  const members=board.members.filter(m=>`${m.full_name} ${m.email}`.toLocaleLowerCase("az").includes(search.toLocaleLowerCase("az")));
  return <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
    <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"><h2 className="text-lg font-semibold">Sahib əlavə et</h2><p className="mt-2 text-sm leading-6 text-slate-500">Email və parolu sahibə ayrıca ver. Sahib saytın giriş səhifəsindən daxil olacaq.</p>
    {!board.can_create?<p className="mt-5 rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-900">Yeni hesab yaratmaq üçün restoran aktiv və ya sınaq rejimində olmalıdır. Mövcud sahib hesablarının girişini aşağıdakı siyahıdan dəyişə bilərsən.</p>:<form action={action} className="mt-5 space-y-4">
      <input type="hidden" name="restaurant_id" value={restaurantId}/>
      <label className="block space-y-2 text-sm font-medium"><span>Ad və soyad</span><input name="full_name" value={details.full_name} onChange={e=>setDetails(d=>({...d,full_name:e.target.value}))} required maxLength={150} autoComplete="off" disabled={pending} className={input}/></label>
      <label className="block space-y-2 text-sm font-medium"><span>Email</span><input name="email" value={details.email} onChange={e=>setDetails(d=>({...d,email:e.target.value}))} type="email" required maxLength={254} autoComplete="off" disabled={pending} className={input}/></label>
      <label className="block space-y-2 text-sm font-medium"><span>Parol</span><input name="password" aria-label="Parol" aria-describedby="owner-password-help" value={details.password} onChange={e=>setDetails(d=>({...d,password:e.target.value}))} type={showPassword?"text":"password"} required minLength={12} maxLength={128} autoComplete="new-password" disabled={pending} className={input}/><span id="owner-password-help" className="block text-xs font-normal leading-5 text-slate-500">Ən azı 12 simvol, hərf və rəqəm.</span></label>
      <button type="button" aria-pressed={showPassword} onClick={()=>setShowPassword(v=>!v)} disabled={pending} className="min-h-11 text-sm font-medium text-emerald-800">{showPassword?"Parolu gizlət":"Parolu göstər"}</button>
      <button disabled={pending} className={`${button} w-full`}>{pending?"Hesab yaradılır...":"Sahib hesabını yarat"}</button>
    </form>}<div className="mt-4"><Feedback state={state}/></div></section>
    <section className="min-w-0 space-y-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg font-semibold">Sahib siyahısı ({board.members.length})</h2><button onClick={()=>router.refresh()} className="min-h-11 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">Siyahını yenilə</button></div>
    <p className="text-sm leading-6 text-slate-500">Girişi deaktiv etmək bu restorana idarəetmə girişini bağlayır. Restoranın məlumatları saxlanılır.</p>
    <input value={search} onChange={e=>setSearch(e.target.value)} aria-label="Sahib axtar" placeholder="Ad və ya email ilə axtar" className={input}/>
    {!members.length&&<p className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-500">{search?"Uyğun sahib tapılmadı.":"Hələ sahib hesabı əlavə edilməyib."}</p>}
    {members.map(member=><OwnerRow key={`${member.id}:${member.version}`} restaurantId={restaurantId} member={member}/>)}
    </section>
  </div>;
}
