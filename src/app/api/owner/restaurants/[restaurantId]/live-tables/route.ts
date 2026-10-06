import {ownerUUID} from "@/lib/owner-dashboard";
import {parseLiveQuery} from "@/lib/live-tables";
import {readLiveTables} from "@/lib/live-tables-read";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff"};
export async function GET(request:Request,{params}:{params:Promise<{restaurantId:string}>}){
  const {restaurantId}=await params;if(!ownerUUID.test(restaurantId))return Response.json({error:"Restoran seçimi düzgün deyil."},{status:400,headers});
  const search=new URL(request.url).searchParams,query:Record<string,string|string[]|undefined>={};
  for(const key of ["branch","view","q","limit"]){const values=search.getAll(key);query[key]=values.length>1?values:values[0];}
  const {filters,warning}=parseLiveQuery(query);if(warning)return Response.json({error:"Filial, masa və ya vəziyyət seçimini düzgün daxil et."},{status:400,headers});
  const result=await readLiveTables(restaurantId,filters);
  return Response.json(result,{status:result.data?200:result.unauthenticated?401:result.denied?403:503,headers});
}
