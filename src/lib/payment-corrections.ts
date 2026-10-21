import {amountCents,centsAmount} from "./account-payments";
import type {PaymentMethod} from "./qr-orders";
export type AllocationPart={id:string|null;label:string;cash:string;card:string;total:string;at:string};
export type AllocationChange={id:string;part_id:string|null;label:string;actor_name:string;old_cash:string;old_card:string;cash:string;card:string;reason:string;at:string};
export type AllocationBoard={user_id:string;session_id:string;branch_id:string;version:number;table_name:string;status:string;currency:string;can_correct:boolean;parts:AllocationPart[];changes:AllocationChange[];change_count:string};
export type AllocationAttempt={request:string;version:number;part:string|null;cash:string;card:string;reason:string;label:string;old_cash:string;old_card:string;currency:string};
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function allocationMethod(part:Pick<AllocationPart,"cash"|"card">):PaymentMethod{return amountCents(part.cash)===BigInt(0)?"CARD":amountCents(part.card)===BigInt(0)?"CASH":"MIXED";}
export function allocationAmounts(total:string,method:PaymentMethod,cash:string,card:string){
 const sum=amountCents(total),c=method==="CARD"?BigInt(0):method==="CASH"?sum:amountCents(cash),k=method==="CASH"?BigInt(0):method==="CARD"?sum:amountCents(card);
 return sum!==null&&sum>BigInt(0)&&c!==null&&k!==null&&c+k===sum&&(method!=="MIXED"||c>BigInt(0)&&k>BigInt(0))?{cash:centsAmount(c),card:centsAmount(k)}:null;
}
export function allocationKey(user:string,restaurant:string,session:string){return `qr-payment-correction:${user}:${restaurant}:${session}`;}
export function readAllocationAttempt(key:string):AllocationAttempt|null{
 try{const raw=sessionStorage.getItem(key);if(!raw||raw.length>6000)return null;const a=JSON.parse(raw) as AllocationAttempt;
  return a&&typeof a.request==="string"&&uuid.test(a.request)&&(a.part===null||typeof a.part==="string"&&uuid.test(a.part))&&Number.isInteger(a.version)&&a.version>0&&typeof a.reason==="string"&&a.reason.trim().length>=3&&a.reason.length<=500&&typeof a.label==="string"&&typeof a.currency==="string"&&[a.cash,a.card,a.old_cash,a.old_card].every(x=>typeof x==="string"&&amountCents(x)!==null)?a:null;
 }catch{return null;}
}
export function allocationError(message?:string){const errors:Record<string,string>={FORBIDDEN:"Ödəniş bölgüsünü yalnız bu restoranın aktiv sahibi düzəldə bilər.",INVALID_CORRECTION:"Ən azı 3 simvolluq səbəb yaz və məlumatları yoxla.",INVALID_PAYMENT_PART:"Ödəniş hissəsi tapılmadı. Cari məlumatları yenilə.",NO_PAYABLE_PART:"Sıfır məbləğli ödənişin bölgüsünü dəyişmək olmur.",CORRECTION_TOTAL_CHANGED:"Nağd və kart məbləğlərinin cəmi seçilmiş ödənişin məbləğinə bərabər olmalıdır.",NO_CHANGES:"Kart/nağd bölgüsündə dəyişiklik etməmisən.",STALE_VERSION:"Hesab başqa ekranda dəyişib. Cari məlumatları yenilə və bölgünü yenidən yoxla.",REQUEST_CONFLICT:"Bu sorğu fərqli məlumatla göndərilib. Cari məlumatları yenilə.",INVALID_PAYMENT_AMOUNT:"Məbləği düzgün yaz: məsələn, 12.50.",INVALID_PAYMENT_STATE:"Ödəniş məlumatları uyğun gəlmir. Platforma admininə bildir."};return errors[message||""]||"Düzəliş tətbiq olunmadı. Cari məlumatları yenilə və yenidən yoxla.";}
