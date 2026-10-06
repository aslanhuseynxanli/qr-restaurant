export const staffKinds={WAITER:"Ofisiant",KITCHEN:"Mətbəx"} as const;
export type StaffKind=keyof typeof staffKinds;
export const isStaffKind=(v:unknown):v is StaffKind=>v==="WAITER"||v==="KITCHEN";
export const staffUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type StaffBranch={id:string;name:string;is_active:boolean};
export type StaffMember={id:string;user_id:string;full_name:string;email:string;branch_id:string;staff_kind:StaffKind;is_active:boolean;profile_active:boolean;version:number};
export type StaffManagementBoard={restaurant_name:string;branches:StaffBranch[];members:StaffMember[]};
export type StaffActionState={error:string;success?:string;retryable?:boolean};
export function staffError(error:{code?:string;message?:string}) {
  if(error.code==="42501")return "Bu restoranın işçilərini idarə etmək üçün icazən yoxdur.";
  const messages:Record<string,string>={
    INVALID_STAFF:"İşçinin məlumatlarını düzgün doldur.",INVALID_BRANCH:"Bu restorana aid aktiv filial seç.",
    STALE_VERSION:"Bu işçinin məlumatı başqa pəncərədə dəyişib. Səhifəni yenilə və cari məlumatı yoxla.",
    CREATION_BUSY:"Hesabın yaradılması davam edir. Bir az gözlə və eyni məlumatlarla yenidən cəhd et.",
    REQUEST_CONFLICT:"Yaratma məlumatları dəyişib. Səhifəni yenilə və işçinin siyahıda olub-olmadığını yoxla.",
    PENDING_ACCOUNT:"Hesabın yaradılması yarımçıq qalıb. Əvvəl yazdığın eyni ad, email, filial, vəzifə və parolla yenidən göndər.",
    TOO_MANY_REQUESTS:"İşçi yaratma limiti dolub. Bir qədər sonra yenidən cəhd et.",
  };
  return messages[error.message||""]||"Əməliyyat tamamlanmadı. Eyni məlumatlarla yenidən cəhd et; səhifəni yeniləyəndə işçi siyahısını yoxla.";
}
