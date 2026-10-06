import {readOwnerRPC} from "@/lib/owner-read";
import {ownerUUID} from "@/lib/owner-dashboard";
import {parseSalesQuery,type SalesReport} from "@/lib/sales-report";
import {salesWorkbook} from "@/lib/sales-excel";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const noCache={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request,{params}:{params:Promise<{restaurantId:string}>}) {
  const {restaurantId}=await params;
  if(!ownerUUID.test(restaurantId))return Response.json({error:"Restoran seçimi düzgün deyil."},{status:400,headers:noCache});
  const query=new URL(request.url).searchParams,values:Record<string,string|string[]|undefined>={};
  for(const key of ["branch","from","to"]){const all=query.getAll(key);values[key]=all.length>1?all:all[0];}
  const filters=parseSalesQuery(values);
  if(filters.warning)return Response.json({error:"Filtrləri düzgün seç. Ən çox 366 gün göstərilə bilər."},{status:400,headers:noCache});
  const result=await readOwnerRPC<SalesReport>("owner_sales_report",{p_restaurant_id:restaurantId,p_branch_id:filters.branch,p_from:filters.from,p_to:filters.to});
  if(!result.data)return Response.json({error:result.error,denied:result.denied||false},{status:result.unauthenticated?401:result.denied?403:503,headers:noCache});
  try{
    const data=result.data,bytes=salesWorkbook(data),suffix=data.filters.branch_id?"-"+data.filters.branch_id.slice(0,8):"";
    return new Response(new Uint8Array(bytes).buffer,{headers:{...noCache,"Content-Type":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition":`attachment; filename="satis-${data.filters.from}-${data.filters.to}${suffix}.xlsx"`}});
  }catch{return Response.json({error:"Excel hazırlanmadı. Daha qısa tarix aralığı seç və yenidən cəhd et."},{status:503,headers:noCache});}
}
