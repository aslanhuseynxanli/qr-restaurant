import {ownerUUID,validFilters} from "./owner-dashboard";
export type SalesFilters={branch_id:string|null;from:string;to:string};
export type SalesTotals={currency:string;count:string;total:string;cash:string;card:string;average:string;quantity:string;legacy_count:string;legacy_total:string;legacy_quantity:string};
export type SalesBranch=Omit<SalesTotals,"currency">&{id:string;name:string;is_active:boolean;currency:string|null};
export type SalesDay=Omit<SalesTotals,"average">&{day:string};
export type SalesProduct={id:string;name:string;currency:string;quantity:string;total:string;account_count:string;legacy_quantity:string;legacy_total:string;legacy_account_count:string};
export type SalesReport={restaurant_name:string;day:string;timezone:string;generated_at:string;filters:SalesFilters;branches:{id:string;name:string;is_active:boolean}[];empty_count:string;totals:SalesTotals[];by_branch:SalesBranch[];daily:SalesDay[];products:SalesProduct[]};
export function validSalesFilters(value:unknown):value is SalesFilters {
  if(!value||typeof value!=="object")return false;const v=value as SalesFilters;
  return validFilters({branch_id:v.branch_id,from:v.from,to:v.to,category:null})&&v.from>="0001-01-01";
}
export function salesPeriod(day:string,preset:"today"|"week"|"month"):Pick<SalesFilters,"from"|"to"> {
  if(preset==="today")return {from:day,to:day};
  if(preset==="month")return {from:day.slice(0,7)+"-01",to:day};
  const date=new Date(day+"T00:00:00Z");date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);
  return {from:date.toISOString().slice(0,10),to:day};
}
export function salesQuery(filters:SalesFilters):string {
  const params=new URLSearchParams({from:filters.from,to:filters.to});if(filters.branch_id)params.set("branch",filters.branch_id);return params.toString();
}
export function parseSalesQuery(query:Record<string,string|string[]|undefined>):{branch:string|null;from:string|null;to:string|null;warning:string} {
  const get=(name:string)=>typeof query[name]==="string"?query[name] as string:"";
  let branch=get("branch")||null,from=get("from")||null,to=get("to")||null;
  let warning=["branch","from","to"].some(name=>Array.isArray(query[name]))?"Filtrlər düzgün deyil. Cari seçim göstərilir.":"";
  if(branch&&!ownerUUID.test(branch)){branch=null;warning="Filial seçimi düzgün deyil. Bütün filiallar göstərilir.";}
  if((from||to)&&!validSalesFilters({branch_id:branch,from,to})){from=null;to=null;warning="Tarix aralığı düzgün deyil. Bu gün göstərilir; ən çox 366 gün seçilə bilər.";}
  return {branch,from,to,warning};
}
export function sortSalesProducts(products:SalesProduct[],legacy:boolean,sort:"quantity"|"total"):SalesProduct[] {
  const count=legacy?"legacy_quantity":"quantity",amount=legacy?"legacy_total":"total";
  const cents=(value:string)=>{const [whole,fraction=""]=value.split(".");return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));};
  return products.filter(p=>BigInt(p[count])>BigInt(0)).slice().sort((a,b)=>{
    const first=sort==="quantity"?BigInt(b[count])-BigInt(a[count]):cents(b[amount])-cents(a[amount]);
    const second=sort==="quantity"?cents(b[amount])-cents(a[amount]):BigInt(b[count])-BigInt(a[count]);
    const diff=first||second;return diff>BigInt(0)?1:diff<BigInt(0)?-1:a.name.localeCompare(b.name,"az")||a.id.localeCompare(b.id)||a.currency.localeCompare(b.currency);
  });
}
export function filledSalesDays(report:SalesReport,currency:string):SalesDay[] {
  const rows=new Map(report.daily.filter(d=>d.currency===currency).map(d=>[d.day,d]));
  const result:SalesDay[]=[],date=new Date(report.filters.from+"T00:00:00Z"),end=Date.parse(report.filters.to+"T00:00:00Z");
  for(let i=0;i<366;i++){if(date.getTime()>end)break;const day=date.toISOString().slice(0,10);
    result.push(rows.get(day)||{day,currency,count:"0",total:"0.00",cash:"0.00",card:"0.00",quantity:"0",legacy_count:"0",legacy_total:"0.00",legacy_quantity:"0"});date.setUTCDate(date.getUTCDate()+1);
  }
  return result;
}
export function salesCents(value:string):bigint {const [whole,fraction=""]=value.split(".");return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));}
