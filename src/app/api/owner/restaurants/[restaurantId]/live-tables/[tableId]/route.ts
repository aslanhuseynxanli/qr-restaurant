import {ownerUUID} from "@/lib/owner-dashboard";
import {parseDetailQuery} from "@/lib/live-tables";
import {readLiveDetail} from "@/lib/live-tables-read";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request,{params}:{params:Promise<{restaurantId:string;tableId:string}>}){
  const {restaurantId,tableId}=await params;
  if(!ownerUUID.test(restaurantId)||!ownerUUID.test(tableId))return Response.json({error:"Masa seçimi düzgün deyil."},{status:400,headers});
  const search=new URL(request.url).searchParams,query:Record<string,string|string[]|undefined>={};
  for(const key of ["mode","limit"]){const values=search.getAll(key);query[key]=values.length>1?values:values[0];}
  const {filters,warning}=parseDetailQuery(query);if(warning)return Response.json({error:"Sifariş seçimini düzgün daxil et."},{status:400,headers});
  const result=await readLiveDetail(restaurantId,tableId,filters);
  return Response.json(result,{status:result.data?200:result.unauthenticated?401:result.denied?403:503,headers});
}
