"use server";
import {revalidatePath} from "next/cache";
import {createClient} from "@/lib/supabase/server";
import {staffAdminClient} from "@/lib/supabase/admin";
import {ownerError,ownerUUID,type OwnerActionState} from "@/lib/owner-management";

const field=(form:FormData,name:string)=>{const value=form.get(name);return typeof value==="string"?value:"";};
type Job={status:"PENDING"|"COMPLETE";job_id:string;lease_token:string};

export async function createOwnerAction(_previous:OwnerActionState,form:FormData):Promise<OwnerActionState> {
  const restaurantId=field(form,"restaurant_id"),requestId=field(form,"request_id");
  const name=field(form,"full_name").trim(),email=field(form,"email").trim().toLowerCase(),password=field(form,"password");
  if(!ownerUUID.test(restaurantId)||!ownerUUID.test(requestId)||!name||name.length>150||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {error:"Adı və emaili düzgün doldur."};
  if(password.length<12||password.length>128||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return {error:"Parol 12–128 simvol olmalı, hərf və rəqəm saxlamalıdır."};
  const supabase=await createClient();let job:Job|undefined;
  try {
    const {data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {error:"Hesabına yenidən daxil ol."};
    const {client:admin,fingerprint}=staffAdminClient();
    const prepared=await supabase.rpc("owner_prepare_account",{p_restaurant_id:restaurantId,p_full_name:name,p_email:email,
      p_fingerprint:fingerprint([auth.user.id,restaurantId,name,email,password]),p_request_id:requestId});
    if(prepared.error)return {error:ownerError(prepared.error),retryable:prepared.error.message==="CREATION_BUSY"};
    job=prepared.data as Job;
    if(!job)throw new Error("REQUEST_FAILED");
    if(job.status!=="COMPLETE") {
      const find=()=>admin.rpc("owner_created_user",{p_job_id:job!.job_id,p_lease_token:job!.lease_token});
      const existing=await find();if(existing.error)throw existing.error;
      let userId=existing.data as string|null;
      if(!userId) {
        const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name},app_metadata:{qr_owner_job_id:job.job_id}});
        userId=created.data.user?.id||null;
        if(!userId) {
          const recovered=await find();if(recovered.error)throw recovered.error;userId=recovered.data as string|null;
          if(!userId) {
            const code=created.error?.code;
            if(code==="email_exists"||code==="user_already_exists")return {error:"Bu email ilə hesab artıq mövcuddur. Yeni sahib üçün başqa email istifadə et."};
            if(code==="weak_password")return {error:"Supabase bu parolu qəbul etmədi. Daha güclü parol yaz."};
            return {error:"Hesab yaradılmadı. Eyni məlumatlarla yenidən cəhd et.",retryable:true};
          }
        }
      }
      const args={p_job_id:job.job_id,p_lease_token:job.lease_token,p_user_id:userId};
      let completed=await supabase.rpc("owner_complete_account",args);
      // Retry an ambiguous response with the same job, never by changing another account's password.
      if(completed.error&&completed.error.code!=="42501"&&completed.error.code!=="P0001")completed=await supabase.rpc("owner_complete_account",args);
      if(completed.error)return {error:ownerError(completed.error),retryable:true};
    }
  }catch(error){
    if(error instanceof Error&&error.message==="SERVER_NOT_CONFIGURED")return {error:"Serverdə SUPABASE_SECRET_KEY dəyişəni çatışmır."};
    return {error:ownerError(error as {code?:string;message?:string}),retryable:true};
  }finally {
    if(job?.status==="PENDING")try{await supabase.rpc("owner_release_account",{p_job_id:job.job_id,p_lease_token:job.lease_token});}catch{}
  }
  revalidatePath(`/admin/restaurants/${restaurantId}/owners`);revalidatePath("/admin");
  return {error:"",success:"Sahib hesabı yaradıldı. Email və seçdiyin parolla öz restoranına daxil ola bilər."};
}

export async function updateOwnerAction(_previous:OwnerActionState,form:FormData):Promise<OwnerActionState> {
  const restaurantId=field(form,"restaurant_id"),memberId=field(form,"member_id");
  const version=Number(field(form,"version")),active=field(form,"is_active");
  if(!ownerUUID.test(restaurantId)||!ownerUUID.test(memberId)||!Number.isInteger(version)||version<1||version>2147483646||!["true","false"].includes(active))return {error:"Sahib məlumatları düzgün deyil. Səhifəni yenilə."};
  try {
    const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {error:"Hesabına yenidən daxil ol."};
    const {error}=await supabase.rpc("owner_update_member",{p_restaurant_id:restaurantId,p_member_id:memberId,p_is_active:active==="true",p_version:version});
    if(error)return {error:ownerError(error)};
  }catch{return {error:"Bağlantı alınmadı. Yenidən cəhd et."};}
  revalidatePath(`/admin/restaurants/${restaurantId}/owners`);revalidatePath("/admin");
  return {error:"",success:"Sahib hesabının girişi yeniləndi."};
}
