import type { SupabaseClient } from "@supabase/supabase-js";

const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
async function preparePhoto(file: File): Promise<File> {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Şəkil ən çox 5 MB ola bilər.");
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Şəkil açılmadı. JPG və ya PNG faylı seç."); });
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 25000000) throw new Error("Şəkilin ölçüsü çox böyükdür. Daha kiçik şəkil seç.");
    if (extensions[file.type]) return file;
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Şəkil hazırlanmadı. JPG və ya PNG faylı seç.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (!blob || !extensions[blob.type]) throw new Error("Şəkil çevrilmədi. JPG və ya PNG faylı seç.");
    return new File([blob], "menu-photo." + extensions[blob.type], { type: blob.type });
  } finally { bitmap.close(); }
}

export async function uploadImportPhoto(supabase: SupabaseClient, restaurantId: string, file: File): Promise<string> {
  const photo = await preparePhoto(file);
  const path = `${restaurantId.toLowerCase()}/${crypto.randomUUID()}.${extensions[photo.type]}`;
  const { error } = await supabase.storage.from("menu-images").upload(path, photo, { upsert: false, contentType: photo.type, cacheControl: "31536000" });
  if (error) throw new Error("Şəkil yüklənmədi. İnterneti və restoran hesabının icazəsini yoxla; sonra yenidən cəhd et.");
  return supabase.storage.from("menu-images").getPublicUrl(path).data.publicUrl;
}
