import { NextRequest,NextResponse } from "next/server";
import { gatewayClient,gatewayRateKey,parseVisitCookie,publicGatewayError,qrUUID,visitCookieName } from "@/lib/qr-gateway";

export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{slug:string;token:string}>};
function response(data:unknown,status=200) {
  const result=NextResponse.json(data,{status});
  result.headers.set("Cache-Control","private, no-store, max-age=0");
  result.headers.set("Referrer-Policy","no-referrer");
  result.headers.set("X-Content-Type-Options","nosniff");
  if (status===429) result.headers.set("Retry-After","60");
  return result;
}
async function boundedJSON(request:NextRequest) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new Error("INVALID_REQUEST");
  const length=Number(request.headers.get("content-length")||0);
  if (!Number.isFinite(length)||length>65536) throw new Error("INVALID_REQUEST");
  const reader=request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  let total=0;const chunks:Uint8Array[]=[];
  try { while (true) { const {value,done}=await reader.read();if(done)break;total+=value.byteLength;if(total>65536)throw new Error("INVALID_REQUEST");chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const parsed:unknown=JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed||typeof parsed!=="object"||Array.isArray(parsed)) throw new Error("INVALID_REQUEST");
  return parsed as Record<string,unknown>;
}
async function context(request:NextRequest,ctx:Context,read:boolean) {
  const {slug,token}=await ctx.params;
  if (slug.length>200||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)||!/^[0-9a-f]{32}$/.test(token)) throw new Error("INVALID_QR");
  const client=gatewayClient();
  const limit=await client.rpc("qr_gateway_limit",{p_key:gatewayRateKey(request,read),p_read:read});
  if(limit.error)throw new Error("REQUEST_FAILED");
  if(limit.data!==true)throw new Error("TOO_MANY_REQUESTS");
  const visit=parseVisitCookie(request.cookies.get(visitCookieName(token))?.value);
  return {slug,token,client,visit};
}
function failure(error:unknown) {
  const code=publicGatewayError(error instanceof Error?error:{message:"REQUEST_FAILED"});
  return response({error:code},code==="TOO_MANY_REQUESTS"?429:code==="VISIT_EXPIRED"?401:code==="INVALID_QR"?404:code==="SERVER_NOT_CONFIGURED"?503:400);
}
function sameOrigin(request:NextRequest) {
  const origin=request.headers.get("origin"),host=request.headers.get("host");
  if(!host)return false;
  if(!origin)return request.headers.get("sec-fetch-site")==="same-origin"
    && ["cors","same-origin"].includes(request.headers.get("sec-fetch-mode")||"")
    && request.headers.get("sec-fetch-dest")==="empty";
  try{return new URL(origin).origin===new URL(`${request.nextUrl.protocol}//${host}`).origin;}catch{return false;}
}
export async function GET(request:NextRequest,ctx:Context) {
  try {
    if(request.headers.get("sec-fetch-site")==="cross-site")return response({error:"INVALID_REQUEST"},403);
    const {slug,token,client,visit}=await context(request,ctx,true);
    if(!visit)return response({view:null});
    const {data,error}=await client.rpc("qr_get_visit",{p_slug:slug,p_token:token,p_visit_id:visit.id,p_secret:visit.secret});
    if(error)throw new Error(publicGatewayError(error));
    return response({view:data});
  }catch(error){return failure(error);}
}
export async function POST(request:NextRequest,ctx:Context) {
  try {
    // Strict same-origin mutations, including calls made without an administrator login.
    if(!sameOrigin(request)||request.headers.get("sec-fetch-site")==="cross-site")return response({error:"INVALID_REQUEST"},403);
    const body=await boundedJSON(request);
    if(!["visit","order","service"].includes(String(body.action)))throw new Error("INVALID_REQUEST");
    const {slug,token,client,visit}=await context(request,ctx,false);
    const lat=body.latitude,lon=body.longitude;
    if(lat!==null&&(typeof lat!=="number"||!Number.isFinite(lat)||lat< -90||lat>90))throw new Error("LOCATION_REQUIRED");
    if(lon!==null&&(typeof lon!=="number"||!Number.isFinite(lon)||lon< -180||lon>180))throw new Error("LOCATION_REQUIRED");
    const base={p_slug:slug,p_token:token,p_latitude:lat,p_longitude:lon};
    if(body.action==="visit") {
      const {data,error}=await client.rpc("qr_open_visit",{...base,p_visit_id:visit?.id||null,p_secret:visit?.secret||null});
      if(error)throw new Error(publicGatewayError(error));
      if(!data||!qrUUID.test(data.visit_id)||!/^[0-9a-f]{64}$/.test(data.secret||""))throw new Error("REQUEST_FAILED");
      const result=response({view:data.view});
      result.cookies.set(visitCookieName(token),`${data.visit_id}.${data.secret}`,{httpOnly:true,secure:process.env.NODE_ENV==="production",sameSite:"strict",path:`/api/qr/${slug}/${token}`,maxAge:8*60*60});
      return result;
    }
    if(!visit)throw new Error("VISIT_EXPIRED");
    if(typeof body.requestId!=="string"||!qrUUID.test(body.requestId))throw new Error("INVALID_REQUEST");
    const auth={...base,p_visit_id:visit.id,p_secret:visit.secret,p_request_id:body.requestId};
    if(body.action==="order") {
      if(!Array.isArray(body.items)||body.items.length<1||body.items.length>50||typeof body.note!=="string"||body.note.length>500||typeof body.currency!=="string"||body.currency.length<1||body.currency.length>10)throw new Error("INVALID_ORDER");
      const items=body.items.map((value:unknown)=>{
        if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("INVALID_ORDER");
        const row=value as Record<string,unknown>;
        if(typeof row.id!=="string"||!qrUUID.test(row.id)||typeof row.quantity!=="number"||!Number.isInteger(row.quantity)||row.quantity<1||row.quantity>20||typeof row.price!=="string"||row.price.length>16||!/^\d+(\.\d{1,2})?$/.test(row.price))throw new Error("INVALID_ORDER");
        return {id:row.id,quantity:row.quantity,price:row.price};
      });
      const {data,error}=await client.rpc("qr_submit_order",{...auth,p_items:items,p_currency:body.currency,p_note:body.note});
      if(error)throw new Error(publicGatewayError(error));
      return response({view:data.view,orderId:data.order_id});
    }
    if(body.kind!=="WAITER"&&body.kind!=="BILL")throw new Error("INVALID_REQUEST");
    const {data,error}=await client.rpc("qr_request_service",{...auth,p_kind:body.kind});
    if(error)throw new Error(publicGatewayError(error));
    return response({view:data});
  }catch(error){return failure(error);}
}
