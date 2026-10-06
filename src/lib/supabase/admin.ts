import "server-only";
import {createHmac} from "node:crypto";
import {createClient} from "@supabase/supabase-js";

export function staffAdminClient() {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SERVER_NOT_CONFIGURED");
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(25000)})}});
  return {client,fingerprint:(fields:unknown[])=>createHmac("sha256",key).update(JSON.stringify(fields)).digest("hex")};
}
