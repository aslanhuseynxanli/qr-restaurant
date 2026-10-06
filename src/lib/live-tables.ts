import {ownerUUID} from "./owner-dashboard";
import type {OrderStatus,PaymentMethod} from "./qr-orders";

export const tableViews={ALL:"Bütün masalar",OPEN:"Açıq hesablar",NEW:"Yeni sifariş",WORKING:"Hazırlanan",READY:"Hazır sifariş",BILL:"Hesab istəyi",WAITER:"Ofisiant çağırışı",FREE:"Açıq hesab yoxdur"} as const;
export type TableView=keyof typeof tableViews;
export type LiveFilters={branch_id:string|null;view:TableView;search:string;limit:number};
export type DetailFilters={mode:"ACTIVE"|"ALL";limit:number};
export type LiveCall={kind:"WAITER"|"BILL";status:"NEW"|"SEEN";method:PaymentMethod|null;created_at:string};
export type LiveAmount={currency:string;total:string};
export type LiveTable={id:string;name:string;number:number;is_active:boolean;branch_id:string;branch_name:string;branch_active:boolean;accepting_orders:boolean;session_id:string|null;session_status:"OPEN"|"BILL_REQUESTED"|null;opened_at:string|null;oldest_order_at:string|null;waiter_at:string|null;bill_at:string|null;services:LiveCall[];amounts:LiveAmount[];orders:{all:string;new:string;working:string;ready:string;served:string;cancelled:string}};
export type LiveBoard={restaurant_name:string;generated_at:string;filters:LiveFilters;branches:{id:string;name:string;is_active:boolean}[];summary:Record<TableView,string>;matched_count:string;has_more:boolean;tables:LiveTable[]};
export type LiveOrder={id:string;number:string;status:OrderStatus;total:string;currency:string;note:string|null;created_at:string;items:{name:string;quantity:string;price:string;total:string}[]};
export type LiveDetail={restaurant_name:string;generated_at:string;filters:DetailFilters;table:Pick<LiveTable,"id"|"name"|"number"|"is_active"|"branch_id"|"branch_name"|"branch_active"|"accepting_orders">;session:{id:string;status:"OPEN"|"BILL_REQUESTED";opened_at:string;counts:{all:string;active:string;served:string;cancelled:string};amounts:LiveAmount[];services:LiveCall[]}|null;matched_count:string;has_more:boolean;orders:LiveOrder[]};

export const validLiveLimit=(value:unknown):value is number=>typeof value==="number"&&Number.isInteger(value)&&value>=30&&value<=300&&value%30===0;
export function validLiveFilters(value:unknown):value is LiveFilters{
  if(!value||typeof value!=="object")return false;
  const v=value as LiveFilters;
  return (v.branch_id===null||typeof v.branch_id==="string"&&ownerUUID.test(v.branch_id))
    &&typeof v.view==="string"&&Object.hasOwn(tableViews,v.view)
    &&typeof v.search==="string"&&v.search.length<=80&&v.search.trim()===v.search&&validLiveLimit(v.limit);
}
export function validDetailFilters(value:unknown):value is DetailFilters{
  if(!value||typeof value!=="object")return false;const v=value as DetailFilters;
  return (v.mode==="ACTIVE"||v.mode==="ALL")&&validLiveLimit(v.limit);
}
type Query=Record<string,string|string[]|undefined>;
const single=(q:Query,key:string)=>typeof q[key]==="string"?q[key] as string:"";
function limitFrom(q:Query):number{
  const text=single(q,"limit");return !text?30:/^[1-9]\d{1,2}$/.test(text)?Number(text):-1;
}
export function parseLiveQuery(query:Query):{filters:LiveFilters;warning:string}{
  let branch=single(query,"branch")||null,view=single(query,"view")||"ALL",search=single(query,"q").trim(),limit=limitFrom(query);
  let invalid=["branch","view","q","limit"].some(key=>Array.isArray(query[key]));
  if(branch&&!ownerUUID.test(branch)){branch=null;invalid=true;}
  if(!Object.hasOwn(tableViews,view)){view="ALL";invalid=true;}
  if(search.length>80){search="";invalid=true;}
  if(!validLiveLimit(limit)){limit=30;invalid=true;}
  return {filters:{branch_id:branch,view:view as TableView,search,limit},warning:invalid?"Seçim düzgün deyil. Düzəldilmiş filtrlər göstərilir.":""};
}
export function parseDetailQuery(query:Query):{filters:DetailFilters;warning:string}{
  let mode=single(query,"mode")||"ACTIVE",limit=limitFrom(query);
  let invalid=["mode","limit"].some(key=>Array.isArray(query[key]));
  if(mode!=="ACTIVE"&&mode!=="ALL"){mode="ACTIVE";invalid=true;}
  if(!validLiveLimit(limit)){limit=30;invalid=true;}
  return {filters:{mode:mode as DetailFilters["mode"],limit},warning:invalid?"Seçim düzgün deyil. Cari sifarişlər göstərilir.":""};
}
export function liveQuery(filters:LiveFilters):string{
  const query=new URLSearchParams({view:filters.view,limit:String(filters.limit)});
  if(filters.branch_id)query.set("branch",filters.branch_id);if(filters.search)query.set("q",filters.search);
  return query.toString();
}
export function detailQuery(filters:DetailFilters):string{return new URLSearchParams({mode:filters.mode,limit:String(filters.limit)}).toString();}
export function liveReturnQuery(value:unknown):string{
  if(typeof value!=="string"||value.length>1000)return "";
  const params=new URLSearchParams(value),query:Query={};
  for(const key of ["branch","view","q","limit"]){const values=params.getAll(key);query[key]=values.length>1?values:values[0];}
  const result=parseLiveQuery(query);return result.warning?"":liveQuery(result.filters);
}
export function hasCount(value:string):boolean{return BigInt(value)>BigInt(0);}
export function elapsedText(at:string|null,now:number):string{
  if(!at)return "";const started=Date.parse(at);if(!Number.isFinite(started))return "";
  const minutes=Math.max(0,Math.floor((now-started)/60000));
  if(minutes<1)return "İndi";if(minutes<60)return `${minutes} dəq`;
  const hours=Math.floor(minutes/60);if(hours<24)return `${hours} saat ${minutes%60} dəq`;
  return `${Math.floor(hours/24)} gün ${hours%24} saat`;
}
