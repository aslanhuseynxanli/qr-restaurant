"use server";
import {revalidatePath} from "next/cache";
import {createClient} from "@/lib/supabase/server";
import {staffAdminClient} from "@/lib/supabase/admin";
import {staffError,staffUUID,type StaffActionState} from "@/lib/staff-management";

const field=(form:FormData,name:string)=>{const value=form.get(name);return typeof value==="string"?value:"";};
type Job={status:"PENDING"|"COMPLETE";job_id:string;lease_token:string};

export async function createStaffAction(_previous:StaffActionState,form:FormData):Promise<StaffActionState> {
  const restaurantId=field(form,"restaurant_id"),branchId=field(form,"branch_id"),requestId=field(form,"request_id");
  const name=field(form,"full_name").trim(),email=field(form,"email").trim().toLowerCase(),password=field(form,"password");
  if(!staffUUID.test(restaurantId)||!staffUUID.test(branchId)||!staffUUID.test(requestId)||!name||name.length>150||email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return {error:"Adı, emaili və filialı düzgün doldur."};
  if(password.length<12||password.length>128||!/[A-Za-z]/.test(password)||!/[0-9]/.test(password))return {error:"Parol 12–128 simvol olmalı, hərf və rəqəm saxlamalıdır."};
  const supabase=await createClient();let job:Job|undefined;
  try {
    const {data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {error:"Hesabına yenidən daxil ol."};
    const {client:admin,fingerprint}=staffAdminClient();
    const prepared=await supabase.rpc("staff_prepare_account",{p_restaurant_id:restaurantId,p_branch_id:branchId,p_full_name:name,p_email:email,
      p_fingerprint:fingerprint([auth.user.id,restaurantId,branchId,name,email,password]),p_request_id:requestId});
    if(prepared.error)return {error:staffError(prepared.error),retryable:prepared.error.message==="CREATION_BUSY"};
    job=prepared.data as Job;
    if(!job)throw new Error("REQUEST_FAILED");
    if(job.status!=="COMPLETE") {
      const find=()=>admin.rpc("staff_created_user",{p_job_id:job!.job_id,p_lease_token:job!.lease_token});
      const existing=await find();if(existing.error)throw existing.error;
      let userId=existing.data as string|null;
      if(!userId) {
        const created=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:name},app_metadata:{qr_staff_job_id:job.job_id}});
        userId=created.data.user?.id||null;
        if(!userId) {
          const recovered=await find();if(recovered.error)throw recovered.error;userId=recovered.data as string|null;
          if(!userId) {
            const code=created.error?.code;
            if(code==="email_exists"||code==="user_already_exists")return {error:"Bu email ilə hesab artıq mövcuddur. Yeni işçi üçün başqa email istifadə et."};
            if(code==="weak_password")return {error:"Supabase bu parolu qəbul etmədi. Daha güclü parol yaz."};
            return {error:"Hesab yaradılmadı. Eyni məlumatlarla yenidən cəhd et.",retryable:true};
          }
        }
      }
      const args={p_job_id:job.job_id,p_lease_token:job.lease_token,p_user_id:userId};
      let completed=await supabase.rpc("staff_complete_account",args);
      // Retry an ambiguous response with the same job, never by changing another account's password.
      if(completed.error&&completed.error.code!=="42501"&&completed.error.code!=="P0001")completed=await supabase.rpc("staff_complete_account",args);
      if(completed.error)return {error:staffError(completed.error),retryable:true};
    }
  }catch(error){
    if(error instanceof Error&&error.message==="SERVER_NOT_CONFIGURED")return {error:"Serverdə SUPABASE_SECRET_KEY dəyişəni çatışmır."};
    return {error:staffError(error as {code?:string;message?:string}),retryable:true};
  }finally {
    if(job?.status==="PENDING")try{await supabase.rpc("staff_release_account",{p_job_id:job.job_id,p_lease_token:job.lease_token});}catch{}
  }
  revalidatePath(`/admin/restaurants/${restaurantId}/staff`);revalidatePath("/admin");
  return {error:"",success:"İşçi yaradıldı. Email və seçdiyin parolla giriş edə bilər."};
}

export async function updateStaffAction(_previous:StaffActionState,form:FormData):Promise<StaffActionState> {
  const restaurantId=field(form,"restaurant_id"),memberId=field(form,"member_id"),branchId=field(form,"branch_id");
  const version=Number(field(form,"version")),active=field(form,"is_active");
  if(!staffUUID.test(restaurantId)||!staffUUID.test(memberId)||!staffUUID.test(branchId)||!Number.isInteger(version)||version<1||version>2147483646||!["true","false"].includes(active))return {error:"İşçi məlumatları düzgün deyil. Səhifəni yenilə."};
  try {
    const supabase=await createClient(),{data:auth,error:authError}=await supabase.auth.getUser();
    if(authError||!auth.user)return {error:"Hesabına yenidən daxil ol."};
    const {error}=await supabase.rpc("staff_update_member",{p_restaurant_id:restaurantId,p_member_id:memberId,p_branch_id:branchId,p_is_active:active==="true",p_version:version});
    if(error)return {error:staffError(error)};
  }catch{return {error:"Bağlantı alınmadı. Yenidən cəhd et."};}
  revalidatePath(`/admin/restaurants/${restaurantId}/staff`);revalidatePath("/admin");
  return {error:"",success:"İşçi məlumatları yeniləndi."};
}
