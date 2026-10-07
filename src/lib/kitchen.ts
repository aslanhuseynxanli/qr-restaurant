import type {OrderStatus} from "./qr-orders";
export const kitchenLanes={NEW:"Yeni sifarişlər",WORKING:"Hazırlanan",READY:"Hazır sifarişlər"} as const;
export type KitchenLane=keyof typeof kitchenLanes;
export type KitchenFilters={search:string;limit:number};
export type KitchenOrder={id:string;number:string;status:Extract<OrderStatus,"NEW"|"ACCEPTED"|"PREPARING"|"READY">;version:number;lane:KitchenLane;table_id:string;table_number:number;table_name:string;note:string|null;created_at:string;updated_at:string;items:{name:string;quantity:string}[]};
export type KitchenProductSummary={id:string;name:string;new_qty:string;accepted_qty:string;preparing_qty:string;ready_qty:string;to_prepare:string;note_count:string};
export type KitchenBoard={restaurant_name:string;branch_name:string;generated_at:string;filters:KitchenFilters;can_service:boolean;sound_enabled:boolean;latest_new_number:string|null;counts:Record<KitchenLane,string>;orders:KitchenOrder[];product_summary:KitchenProductSummary[]};
export const kitchenNext={NEW:"ACCEPTED",ACCEPTED:"PREPARING",PREPARING:"READY"} as const;
export const kitchenActionLabels={NEW:"Qəbul et",ACCEPTED:"Hazırlamağa başla",PREPARING:"Hazırdır"} as const;
export const validKitchenLimit=(v:unknown):v is number=>typeof v==="number"&&Number.isInteger(v)&&v>=30&&v<=150&&v%30===0;
export function parseKitchenQuery(q:Record<string,string|string[]|undefined>):{filters:KitchenFilters;warning:string}{
  let search=typeof q.q==="string"?q.q.trim():"",limit=typeof q.limit==="string"?Number(q.limit):30;
  let invalid=Array.isArray(q.q)||Array.isArray(q.limit);
  if(search.length>80){search="";invalid=true;}
  if(!validKitchenLimit(limit)||typeof q.limit==="string"&&!/^[1-9]\d{1,2}$/.test(q.limit)){limit=30;invalid=true;}
  return {filters:{search,limit},warning:invalid?"Seçim düzgün deyil. Düzəldilmiş axtarış göstərilir.":""};
}
export function newerKitchenNumber(candidate:string|null,previous:string|null):boolean{
  return candidate!==null&&(previous===null||BigInt(candidate)>BigInt(previous));
}
export function kitchenError(code?:string):string{
  const errors:Record<string,string>={STALE_VERSION:"Başqa işçi bu sifarişi dəyişib. Cari vəziyyəti paneldən yoxla.",
    INVALID_TRANSITION:"Sifarişin vəziyyəti dəyişib. Cari mərhələni yoxla.",TABLE_CLOSED:"Bu masanın hesabı artıq bağlanıb.",
    INVALID_KITCHEN_FILTER:"Axtarış və göstərilən sifariş sayını düzgün seç.",
    FORBIDDEN:"Bu filiala girişin bağlanıb və ya təyinatın dəyişib. Paneldən cari filialını yoxla."};
  return errors[code||""]||"Cavab alınmadı. Paneli yenilə və cari statusu yoxla; əməliyyat tətbiq edilmiş ola bilər.";
}
