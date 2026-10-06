export const ownerUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type OwnerMember={id:string;full_name:string;email:string;is_active:boolean;profile_active:boolean;version:number};
export type OwnerManagementBoard={restaurant_name:string;can_create:boolean;members:OwnerMember[]};
export type OwnerActionState={error:string;success?:string;retryable?:boolean};
export function ownerError(error:{code?:string;message?:string}) {
  if(error.code==="42501")return "Sahib hesablarını yalnız platforma admini idarə edə bilər.";
  const messages:Record<string,string>={
    INVALID_OWNER:"Sahib hesabının məlumatlarını düzgün doldur.",
    RESTAURANT_INACTIVE:"Yeni sahib hesabı üçün restoran aktiv və ya sınaq rejimində olmalıdır.",
    STALE_VERSION:"Bu hesabın girişi başqa pəncərədə dəyişib. Siyahını yenilə və cari vəziyyəti yoxla.",
    CREATION_BUSY:"Hesabın yaradılması davam edir. Bir az gözlə və eyni məlumatlarla yenidən cəhd et.",
    REQUEST_CONFLICT:"Yaratma məlumatları dəyişib. Səhifəni yenilə və hesabın siyahıda olub-olmadığını yoxla.",
    PENDING_ACCOUNT:"Yaratma yarımçıq qalıb. Əvvəl yazdığın eyni ad, email və parolla yenidən göndər.",
    TOO_MANY_REQUESTS:"Hesab yaratma limiti dolub. Bir qədər sonra yenidən cəhd et.",
  };
  return messages[error.message||""]||"Əməliyyat tamamlanmadı. Eyni məlumatlarla yenidən cəhd et; səhifəni yeniləyəndə sahib siyahısını yoxla.";
}
