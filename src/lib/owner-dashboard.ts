import {ownerUUID} from "./owner-management";
export {ownerUUID};
export const activityCategories={ORDERS:"Sifarişlər",TABLES:"Masalar",CALLS:"Çağırışlar",MENU:"Menyu",TEAM:"İşçilər və sahiblər",BRANCHES:"Filiallar",RESTAURANT:"Restoran",OTHER:"Digər"} as const;
export type ActivityCategory=keyof typeof activityCategories;
export type OwnerCounts={today_orders:number;cancelled_orders:number;new_orders:number;working_orders:number;open_tables:number;pending_calls:number;pending_bills:number;closed_tables:number;table_count:number;staff_count:number};
export type OwnerBranch=OwnerCounts&{id:string;name:string;address:string|null;is_active:boolean;accepting_orders:boolean;allowed_radius_meters:number};
export type OwnerEvent={id:string;created_at:string;action:string;entity_type:string;category:ActivityCategory;actor_name:string;actor_role:string|null;branch_name:string|null;name:string|null;table_name:string|null;order_number:string|null;currency:string|null;details:Record<string,unknown>};
export type OwnerDashboard={restaurant:{id:string;name:string;slug:string;can_manage:boolean};day:string;timezone:string;refreshed_at:string;branch_id:string|null;totals:OwnerCounts;closed_amounts:{currency:string;total:string}[];branches:OwnerBranch[];recent_activity:OwnerEvent[]};
export type ActivityFilters={branch_id:string|null;category:ActivityCategory|null;from:string;to:string};
export type ActivityCursor={at:string;id:string};
export type OwnerActivity={restaurant_name:string;branches:{id:string;name:string;is_active:boolean}[];filters:ActivityFilters;events:OwnerEvent[];next_cursor:ActivityCursor|null};
export type OwnerReadResult<T>={data:T;error?:never;denied?:never;unauthenticated?:never}|{data:null;error:string;denied?:boolean;unauthenticated?:boolean};

export function validDate(value:unknown):value is string {
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+"T00:00:00Z");return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function validFilters(value:unknown):value is ActivityFilters {
  if(!value||typeof value!=="object")return false;
  const v=value as ActivityFilters;
  return (v.branch_id===null||typeof v.branch_id==="string"&&ownerUUID.test(v.branch_id))
    &&(v.category===null||typeof v.category==="string"&&Object.hasOwn(activityCategories,v.category))
    &&validDate(v.from)&&validDate(v.to)&&v.to>=v.from
    &&(Date.parse(v.to)-Date.parse(v.from))/86400000<=365;
}
export function validCursor(value:unknown):value is ActivityCursor|null {
  if(value===null)return true;
  if(!value||typeof value!=="object")return false;
  const v=value as ActivityCursor;
  return typeof v.id==="string"&&ownerUUID.test(v.id)&&typeof v.at==="string"&&v.at.length<=40
    &&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v.at)
    &&Number.isFinite(Date.parse(v.at));
}
const months=["yanvar","fevral","mart","aprel","may","iyun","iyul","avqust","sentyabr","oktyabr","noyabr","dekabr"];
const shortMonths=["yan","fev","mar","apr","may","iyn","iyl","avq","sen","okt","noy","dek"];
export function formatOwnerTime(value:string,includeDate=true) {
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Baku",numberingSystem:"latn",day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(new Date(value));
  const get=(type:string)=>parts.find(part=>part.type===type)?.value||"";
  const time=`${get("hour")}:${get("minute")}`;
  return includeDate?`${get("day")} ${shortMonths[Number(get("month"))-1]} ${get("year")} · ${time}`:time;
}
export function formatOwnerDate(value:string) {
  const [year,month,day]=value.split("-");return `${Number(day)} ${months[Number(month)-1]} ${year}`;
}
export function ownerMoney(value:unknown,currency="AZN") {
  const suffix=currency?` ${currency}`:"";
  if(typeof value==="string"&&/^\d+(?:\.\d{1,2})?$/.test(value)){const [whole,fraction=""]=value.split(".");return `${whole}.${fraction.padEnd(2,"0")}${suffix}`;}
  const n=Number(value);return `${Number.isFinite(n)?n.toFixed(2):"—"}${suffix}`;
}
const statuses:Record<string,string>={NEW:"Yeni",ACCEPTED:"Qəbul edildi",PREPARING:"Hazırlanır",READY:"Hazırdır",SERVED:"Servis edildi",COMPLETED:"Tamamlandı",CANCELLED:"Ləğv edildi",SEEN:"Görüldü",DONE:"Tamamlandı"};
export function ownerEventTitle(event:OwnerEvent) {
  const titles:Record<string,string>={"restaurant.created":"Restoran yaradıldı","branch.created":"Filial yaradıldı","branch.location_updated":"Filialın məkanı və radiusu yeniləndi","table.created":"Masa və QR yaradıldı","category.created":"Kateqoriya əlavə edildi","category.updated":"Kateqoriya yeniləndi","product.created":"Məhsul əlavə edildi","product.updated":"Məhsul yeniləndi","branch_product.updated":"Filialın məhsul ayarları yeniləndi","menu.imported":"Menyu import edildi","staff.created":"İşçi hesabı yaradıldı","staff.updated":"İşçinin girişi və filialı yeniləndi","owner.created":"Sahib hesabı yaradıldı","owner.updated":"Sahib hesabının girişi yeniləndi","qr.order_created":"Sifariş verildi","order.created":"Sifariş verildi","qr.bill_payment_selected":"Ödəniş üsulu seçildi"};
  if(event.action==="qr.service_requested")return event.details.kind==="BILL"?"Hesab istənildi":"Ofisiant çağırıldı";
  if(event.action==="qr.staff_action"){
    if(event.entity_type==="qr_close")return "Ödəniş təsdiqləndi və masa bağlandı";
    if(event.entity_type==="qr_clear")return "Boş masa bağlandı";
    if(event.entity_type==="qr_reopen")return "Masa sifariş qəbuluna qaytarıldı";
    if(event.entity_type==="qr_service")return event.details.status==="DONE"?"Çağırış tamamlandı":event.details.kind==="BILL"?"Hesab istəyi görüldü":"Ofisiant çağırışı görüldü";
  }
  if(event.action==="qr.staff_action"&&event.entity_type==="qr_order"||event.action==="order.status_changed"){
    const status=String(event.details.status||event.details.to_status||"");return statuses[status]?`Sifariş: ${statuses[status]}`:"Sifarişin statusu dəyişdirildi";
  }
  return titles[event.action]||"Əməliyyat qeydə alındı";
}
export function ownerEventDetails(event:OwnerEvent) {
  const d=event.details,result:string[]=[];
  if(event.name)result.push(event.name);
  if(event.order_number)result.push(`Sifariş #${event.order_number}`);
  if(event.table_name)result.push(event.table_name);
  if(d.total!==undefined)result.push(ownerMoney(d.total,event.currency||""));
  if(d.base_price!==undefined)result.push(`Qiymət: ${ownerMoney(d.base_price,event.currency||"")}`);
  if(d.price_override!==undefined)result.push(`Filial qiyməti: ${ownerMoney(d.price_override,event.currency||"")}`);
  if(typeof d.is_active==="boolean")result.push(event.category==="TEAM"?`Giriş: ${d.is_active?"aktiv":"deaktiv"}`:`${d.is_active?"Aktiv":"Deaktiv"}`);
  if(typeof d.is_available==="boolean")result.push(d.is_available?"Məhsul mövcuddur":"Məhsul mövcud deyil");
  if(typeof d.is_visible==="boolean")result.push(d.is_visible?"Menyuda görünür":"Menyuda gizlidir");
  if(typeof d.old_branch_name==="string"&&typeof d.branch_name==="string"&&d.old_branch_name!==d.branch_name)result.push(`${d.old_branch_name} → ${d.branch_name}`);
  if(d.allowed_radius_meters!==undefined)result.push(`Radius: ${d.allowed_radius_meters} m`);
  if(event.action==="menu.imported")for(const [key,label] of [["created_products","əlavə edilən məhsul"],["updated_products","yenilənən məhsul"],["created_categories","yeni kateqoriya"],["skipped_products","keçilən məhsul"]])if(typeof d[key]==="number")result.push(`${d[key]} ${label}`);
  const method:Record<string,string>={CASH:"Nağd",CARD:"Kart",MIXED:"Kart + nağd"};
  if(typeof d.payment_method==="string"&&method[d.payment_method])result.push(`Ödəniş: ${method[d.payment_method]}`);
  return result;
}
