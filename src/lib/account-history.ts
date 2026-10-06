import {ownerUUID,validFilters,type ActivityCursor} from "./owner-dashboard";
import {paymentLabels,type PaymentMethod,type OrderStatus} from "./qr-orders";
export const accountMethods={...paymentLabels,LEGACY:"Ödəniş bölgüsü qeyd edilməyib",EMPTY:"Sifarişsiz bağlanıb"};
export type AccountMethod=keyof typeof accountMethods;
export type AccountFilters={branch_id:string|null;method:AccountMethod|null;from:string;to:string;search:string};
export type ClosedAccount={id:string;branch_name:string;table_name:string;table_number:number;opened_at:string;closed_at:string;kind:"PAID"|"LEGACY"|"EMPTY";
  order_count:number;item_count:number;total:string;currency:string;
  payment:null|{number:string;method:PaymentMethod;cash:string;card:string;actor_name:string;actor_role:string;paid_at:string}};
export type AccountHistory={restaurant_name:string;branches:{id:string;name:string;is_active:boolean}[];filters:AccountFilters;
  summary:{count:number;recorded_count:number;legacy_count:number;empty_count:number;amounts:{currency:string;recorded:string;cash:string;card:string;legacy:string}[]};
  accounts:ClosedAccount[];next_cursor:ActivityCursor|null};
export type AccountDetail={restaurant_name:string;account:ClosedAccount;orders:{id:string;number:string;status:OrderStatus;total:string;currency:string;note:string|null;created_at:string;
  items:{name:string;price:string;quantity:number;total:string}[];events:{status:OrderStatus;at:string;actor_name:string}[]}[]};
export function validAccountFilters(value:unknown):value is AccountFilters {
  if(!value||typeof value!=="object")return false;
  const v=value as AccountFilters;
  return validFilters({branch_id:v.branch_id,category:null,from:v.from,to:v.to})
    &&(v.method===null||typeof v.method==="string"&&Object.hasOwn(accountMethods,v.method))&&typeof v.search==="string"&&v.search.length<=80;
}
export function accountTitle(account:ClosedAccount){return account.payment?`Hesab #${account.payment.number}`:account.table_name;}
export function accountLabel(account:ClosedAccount){return account.payment?paymentLabels[account.payment.method]:account.kind==="EMPTY"?accountMethods.EMPTY:accountMethods.LEGACY;}
export function accountUUID(value:unknown):value is string {return typeof value==="string"&&ownerUUID.test(value);}
