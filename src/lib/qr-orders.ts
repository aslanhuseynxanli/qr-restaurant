export type OrderStatus = "NEW" | "ACCEPTED" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
export const orderLabels: Record<OrderStatus,string> = {NEW:"Yeni",ACCEPTED:"Qəbul edildi",PREPARING:"Hazırlanır",READY:"Hazırdır",SERVED:"Servis edildi",CANCELLED:"Ləğv edildi"};
export const orderSteps: OrderStatus[] = ["NEW","ACCEPTED","PREPARING","READY","SERVED"];
export const nextStatus: Partial<Record<OrderStatus,OrderStatus>> = {NEW:"ACCEPTED",ACCEPTED:"PREPARING",PREPARING:"READY",READY:"SERVED"};
export type QROrder = {id:string;request_id:string;number:number;status:OrderStatus;version:number;total:number;currency:string;note:string|null;created_at:string;updated_at:string;items:{name:string;price:number;quantity:number;total:number}[];events:{status:OrderStatus;at:string}[]};
export type PaymentMethod = "CASH" | "CARD" | "MIXED";
export const paymentLabels: Record<PaymentMethod,string> = {CASH:"Nağd",CARD:"Kart",MIXED:"Kart + nağd"};
export function isPaymentMethod(value:unknown): value is PaymentMethod { return value==="CASH"||value==="CARD"||value==="MIXED"; }
export type QRService = {id:string;kind:"WAITER"|"BILL";payment_method?:PaymentMethod|null;status:"NEW"|"SEEN"|"DONE";version?:number;created_at:string;updated_at?:string};
export type VisitView = {session:{id:string;status:"OPEN"|"BILL_REQUESTED"|"CLOSED";table_name:string};orders:QROrder[];services:QRService[]};
export type StaffSession = VisitView["session"] & {version:number;table_number:number;opened_at:string;total:number;currency:string;orders:QROrder[];services:QRService[]};
export type StaffBoard = {sessions:StaffSession[];sound_enabled?:boolean};
export type CartLine = {id:string;name:string;quantity:number;price:number};
export function money(value:number,currency="AZN") { return `${Number(value).toFixed(2)} ${currency}`; }
export function clockTime(value:string) { return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Baku",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(value)); }
export function orderError(code?:string) {
  const errors:Record<string,string> = {
    LOCATION_REQUIRED:"Restoranda olduğunu təsdiqləmək üçün mövqe icazəsini ver və yenidən cəhd et.",
    ORDERS_PAUSED:"Filial hazırda sifariş qəbul etmir.",TABLE_CLOSED:"Masa üçün hesab istənilib və ya hesab bağlanıb. Əlavə sifariş üçün ofisianta müraciət et.",
    VISIT_EXPIRED:"Ziyarətin müddəti bitib. Mövqeni təsdiqləyib yenidən başla.",
    PRICE_CHANGED:"Məhsulun qiyməti dəyişib. Menyu yeniləndi; səbətdəki qiymətləri yoxlayıb yenidən göndər.",
    CURRENCY_CHANGED:"Menyunun valyutası dəyişib. Menyu yeniləndi; qiymətləri yoxla. Masa hesabının valyutası fərqlidirsə ofisianta müraciət et.",
    PRODUCT_UNAVAILABLE:"Səbətdəki məhsullardan biri artıq mövcud deyil. Menyu yeniləndi; səbəti yoxla.",
    TOO_MANY_REQUESTS:"Çox tez-tez sorğu göndərildi. Bir az gözlə və yenidən cəhd et.",
    REQUEST_CONFLICT:"Bu sorğu artıq fərqli məlumatla göndərilib. Sifarişlərini yoxla.",
    INVALID_PAYMENT_METHOD:"Hesab üçün ödəniş üsulunu seç.",
    NO_ORDERS:"Hesab istəmək üçün bu ziyarətdə öz telefonundan ləğv edilməmiş sifarişin olmalıdır.",
    STALE_VERSION:"Başqa işçi bu məlumatı dəyişib. Panel yeniləndi; cari statusu yoxla.",
    UNFINISHED_ORDERS:"Əvvəl bütün sifarişləri servis et və ya ləğv et.",
    FORBIDDEN:"Bu filialda əməliyyat üçün icazən yoxdur.",
    SERVER_NOT_CONFIGURED:"Sifariş sistemi hələ aktivləşdirilməyib. Ofisianta müraciət et.",
  };
  return errors[code||""]||"Əməliyyat tamamlanmadı. Bağlantını yoxla və yenidən cəhd et.";
}
