import Link from "next/link";
import {notFound,redirect} from "next/navigation";
import {readDashboardAction} from "./dashboard-actions";
import {ownerUUID} from "@/lib/owner-dashboard";
import DashboardPanel from "./dashboard-panel";
export default async function RestaurantPage({params}:{params:Promise<{restaurantId:string}>}) {
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))notFound();
  const result=await readDashboardAction(restaurantId,null);
  if(result.unauthenticated)redirect("/login");
  if(result.denied)notFound();
  if(!result.data)throw new Error("Sahib paneli yüklənmədi. 018_owner_dashboard_and_activity.sql yeniləməsini tətbiq et.");
  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 sm:p-8"><div className="mx-auto max-w-6xl space-y-6">
    <Link href="/admin" className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600">← Restoranlara qayıt</Link>
    <DashboardPanel key={restaurantId} restaurantId={restaurantId} initialBoard={result.data}/>
  </div></main>;
}
