import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import type { NextRequest } from "next/server";

export const qrUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function gatewayClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url||!key) throw new Error("SERVER_NOT_CONFIGURED");
  // Dedicated service client: never read or inherit an administrator's login cookie.
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export function gatewayRateKey(request:NextRequest,read:boolean) {
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SERVER_NOT_CONFIGURED");
  // Vercel overwrites this header. For other hosts, a missing trusted IP shares one fallback bucket.
  const value=process.env.VERCEL ? (request.headers.get("x-vercel-forwarded-for")||request.headers.get("x-forwarded-for"))?.split(",")[0].trim() : null;
  const ip=value&&isIP(value)?value:"fallback";
  return createHmac("sha256",key).update(`${read?"read":"write"}:${ip}`).digest("hex");
}
export function visitCookieName(token:string) { return `qr_visit_${token}`; }
export function parseVisitCookie(value?:string) {
  const [id,secret,...rest]=(value||"").split(".");
  return rest.length===0&&qrUUID.test(id||"")&&/^[0-9a-f]{64}$/.test(secret||"") ? {id,secret}:null;
}
export function publicGatewayError(error:{code?:string;message?:string}) {
  const allowed=["LOCATION_REQUIRED","ORDERS_PAUSED","TABLE_CLOSED","VISIT_EXPIRED","PRICE_CHANGED","CURRENCY_CHANGED","PRODUCT_UNAVAILABLE","TOO_MANY_REQUESTS","REQUEST_CONFLICT","NO_ORDERS","INVALID_QR","INVALID_ORDER","INVALID_REQUEST","SERVER_NOT_CONFIGURED"];
  return allowed.includes(error.message||"")?error.message!:"REQUEST_FAILED";
}
