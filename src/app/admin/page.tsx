import Link from "next/link";
import {redirect} from "next/navigation";
import {createClient} from "@/lib/supabase/server";
import {signOutAction} from "@/app/login/actions";

type Restaurant={id:string;name:string;slug:string;status:string;is_active:boolean};
type Assignment={id:string;name:string;restaurant_id:string;restaurant_name:string};
export default async function AdminPage() {
  const supabase=await createClient(),{data:{user},error:authError}=await supabase.auth.getUser();
  if(authError||!user)redirect("/login");
  const [profileResult,platformResult,membersResult]=await Promise.all([
    supabase.from("profiles").select("full_name,is_active").eq("id",user.id).maybeSingle(),
    supabase.from("platform_admins").select("role").eq("user_id",user.id).eq("is_active",true).maybeSingle(),
    supabase.from("restaurant_members").select("role,restaurant_id,branch_id").eq("user_id",user.id).eq("is_active",true),
  ]);
  if(profileResult.error||platformResult.error||membersResult.error)throw new Error("Hesab icazələri oxunmadı. Yenidən cəhd et.");
  const profile=profileResult.data,members=membersResult.data||[];
  const role=!profile?.is_active?null:platformResult.data?.role==="SUPER_ADMIN"?"SUPER_ADMIN":members.some(m=>m.role==="RESTAURANT_ADMIN")?"RESTAURANT_ADMIN":members.some(m=>m.role==="STAFF")?"STAFF":null;
  const ownerIds=members.filter(m=>m.role==="RESTAURANT_ADMIN").map(m=>m.restaurant_id);
  let restaurants:Restaurant[]=[],assignments:Assignment[]=[];
  if(role) {
    const result=await supabase.from("restaurants").select("id,name,slug,status,is_active").order("created_at",{ascending:false});
    if(result.error)throw new Error("Restoranlar yüklənmədi.");
    const visible=(result.data||[]) as Restaurant[];
    restaurants=visible.filter(r=>role==="SUPER_ADMIN"||ownerIds.includes(r.id));
    const staff=members.filter(m=>m.role==="STAFF"&&m.branch_id),branchIds=staff.map(m=>m.branch_id as string);
    if(branchIds.length) {
      const result=await supabase.from("branches").select("id,name,restaurant_id").in("id",branchIds).eq("is_active",true);
      if(result.error)throw new Error("Təyin olunan filiallar yüklənmədi.");
      assignments=(result.data||[]).flatMap(b=>{
        const restaurant=visible.find(r=>r.id===b.restaurant_id&&r.is_active&&["active","trial"].includes(r.status));
        return restaurant&&staff.some(m=>m.branch_id===b.id&&m.restaurant_id===b.restaurant_id)?[{...b,restaurant_name:restaurant.name}]:[];
      });
    }
  }
  const roleName=role==="SUPER_ADMIN"?"Platforma admini":role==="RESTAURANT_ADMIN"?"Restoran sahibi":"İşçi";
  return <main className="min-h-screen bg-slate-50 text-slate-900">
    <header className="border-b border-slate-200 bg-white"><div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4 px-5 py-5"><div><p className="text-lg font-bold">QR Restoran</p><p className="text-sm text-slate-500">İdarəetmə paneli</p></div><div className="flex flex-wrap items-center gap-2">
      {role==="SUPER_ADMIN"&&<Link href="/admin/restaurants/new" className="min-h-11 rounded-xl bg-emerald-700 px-4 py-3 text-sm font-medium text-white">Restoran əlavə et</Link>}
      <form action={signOutAction}><button className="min-h-11 rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium">Çıxış</button></form>
    </div></div></header>
    <div className="mx-auto max-w-5xl space-y-6 px-5 py-8"><section className="rounded-2xl border border-slate-200 bg-white p-6"><h1 className="break-words text-2xl font-bold">{profile?.full_name||"Xoş gəldin"}</h1><p className="mt-2 break-all text-sm text-slate-500">{user.email}</p>
      {role?<span className="mt-4 inline-block rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">{roleName}</span>:<p role="alert" className="mt-4 text-sm text-red-700">{profile?.is_active?"Bu hesaba aktiv idarəetmə rolu təyin edilməyib. Restoran sahibi ilə əlaqə saxla.":"Bu hesab aktiv deyil. Adminlə əlaqə saxla."}</p>}
    </section>
    {role&&role!=="STAFF"&&<section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Restoranlar ({restaurants.length})</h2>{!restaurants.length&&<p className="text-sm text-slate-500">Hələ restoran əlavə edilməyib.</p>}
      {restaurants.map(r=><div key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><div><Link href={`/admin/restaurants/${r.id}`} className="break-words font-medium text-emerald-700">{r.name}</Link><p className="mt-1 text-sm text-slate-500">{r.slug}</p></div><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-slate-100 px-3 py-2 text-xs">{!r.is_active?"Deaktiv":r.status==="active"?"Aktiv":r.status==="trial"?"Sınaq":"Dayandırılıb"}</span>{r.is_active&&["active","trial"].includes(r.status)&&<Link href={`/admin/restaurants/${r.id}/staff`} className="min-h-11 rounded-xl border border-emerald-200 px-4 py-3 text-sm font-medium text-emerald-800">İşçilər</Link>}</div></div>)}
    </section>}
    {!!assignments.length&&<section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6"><h2 className="text-lg font-semibold">Təyin olunan filiallar</h2>{assignments.map(b=><div key={b.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4"><div><p className="break-words font-semibold">{b.name}</p><p className="mt-1 text-sm text-slate-500">{b.restaurant_name}</p></div><Link href={`/admin/restaurants/${b.restaurant_id}/branches/${b.id}/orders`} className="min-h-12 rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white">Sifarişlər və çağırışlar</Link></div>)}</section>}
    {role==="STAFF"&&!assignments.length&&<p role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">Hazırda giriş edə biləcəyin aktiv filial yoxdur. Restoran sahibi ilə əlaqə saxla.</p>}
    </div>
  </main>;
}
