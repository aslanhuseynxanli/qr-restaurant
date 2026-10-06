import type {PaymentMethod,StaffBoard} from "./qr-orders";

// Calculate in qəpik with integers, including mixed payments and decimal commas.
export function amountCents(value:unknown):bigint|null {
  if(typeof value!=="string")return null;
  const normal=value.trim().replace(",",".");
  if(!/^\d{1,16}(?:\.\d{1,2})?$/.test(normal))return null;
  const [whole,fraction=""]=normal.split(".");
  return BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,"0"));
}
export function centsAmount(value:bigint):string {
  return `${value/BigInt(100)}.${(value%BigInt(100)).toString().padStart(2,"0")}`;
}
export function exactMoney(value:string,currency:string):string {
  const cents=amountCents(value);return `${cents===null?"—":centsAmount(cents)} ${currency}`;
}
export type SettlementInput={session_id:string;version:number;request_id:string;method:PaymentMethod;cash:string;card:string;total:string;currency:string};
export type SettlementResult={board:StaffBoard;payment:{session_id:string;number:string;method:PaymentMethod;total:string;cash:string;card:string;currency:string;paid_at:string}};
export type SettlementFeedback={ok:boolean;error?:string;retry?:boolean};
export const paymentErrors:Record<string,string>={
  INVALID_PAYMENT_AMOUNT:"Məbləği düzgün yaz: məsələn, 12.50 və ya 12,50. Ən çox iki onluq rəqəm ola bilər.",
  INVALID_PAYMENT_METHOD:"Faktiki alınmış ödəniş üsulunu seç.",
  PAYMENT_SUM_MISMATCH:"Kart və nağd məbləğlərinin cəmi hesabla eyni olmalıdır. Qarışıq ödənişdə hər iki məbləğ sıfırdan böyük olmalıdır.",
  PAYMENT_TOTAL_CHANGED:"Hesabın məbləği və ya valyutası dəyişib. Pəncərəni bağla, cari hesabı yoxlayıb yenidən aç.",
  STALE_VERSION:"Masa başqa işçi tərəfindən dəyişdirilib. Pəncərəni bağla, cari vəziyyəti yoxlayıb yenidən aç.",
  ACCOUNT_ALREADY_PAID:"Bu hesab başqa işçi tərəfindən artıq bağlanıb. İkinci ödəniş qeydi yaradılmadı.",
  TABLE_CLOSED:"Bu masa hesabı artıq bağlanıb. İkinci ödəniş qeydi yaradılmadı.",
  UNFINISHED_ORDERS:"Əvvəl bütün sifarişləri servis et və ya ləğv et.",
  NO_PAYABLE_ORDERS:"Servis edilmiş sifariş yoxdur. Pəncərəni bağla və sifarişsiz masanı boşalt.",
  INVALID_TRANSITION:"Masa sifariş qəbuluna qaytarılıb. Ödəniş üçün yenidən hesab istənilməlidir.",
  REQUEST_CONFLICT:"Bu təsdiq artıq fərqli məlumatla göndərilib. Cari masa vəziyyətini və hesab tarixçəsini yoxla.",
  PAYMENT_REQUIRED:"Ödənişi qeyd etmək üçün səhifəni yenilə və yeni ödəniş pəncərəsini aç.",
  FORBIDDEN:"Bu filialda ödəniş təsdiqləmək üçün icazən yoxdur.",
};
