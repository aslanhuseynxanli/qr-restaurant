import { parseMenuPrice, type MenuCategory, type MenuProduct } from "./menu-management";
import { isMenuImageUrl } from "./menu-image-url";

export const MAX_IMPORT_ROWS = 1000;
export const MAX_IMPORT_BYTES = 512 * 1024;
export type ImportField = "category" | "name" | "price" | "description" | "image_url";
export type ImportMapping = Record<ImportField, number>;
export type ImportRow = Record<ImportField, string>;
export type ImportImage = { rowNumber: number; column: number; file?: File; error?: string };
export type ImportSheet = { name: string; data: string[][]; images?: ImportImage[]; imageWarnings?: string[] };
export type ImportMode = "skip" | "update";
export type ImportResult = { categories_created: number; products_created: number; products_updated: number; products_skipped: number; rows: number };
export type ReviewRow = { rowNumber: number; values: ImportRow; excluded: boolean; errors: string[]; action: "new" | "skip" | "update"; notes: string[] };
export const importFields: { key: ImportField; label: string; required?: boolean }[] = [
  { key: "category", label: "Kateqoriya" }, { key: "name", label: "Məhsul adı", required: true },
  { key: "price", label: "Qiymət (AZN)", required: true }, { key: "description", label: "Təsvir" }, { key: "image_url", label: "Şəkil keçidi" },
];
const aliases: Record<ImportField, string[]> = {
  category: ["kateqoriya", "category", "kategori", "qrup", "group", "категория", "группа"],
  name: ["mehsuladi", "mehsul", "ad", "name", "product", "productname", "item", "itemname", "urunadi", "наименование", "название", "товар"],
  price: ["qiymet", "qiymetazn", "price", "priceazn", "unitprice", "satisqiymeti", "saleprice", "fiyat", "цена", "стоимость"],
  description: ["tesvir", "description", "aciqlama", "tərkib", "terkib", "описание"],
  image_url: ["sekil", "sekilkecidi", "sekilurl", "image", "imageurl", "photo", "photourl", "resim", "изображение", "фото"],
};
function headerKey(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replaceAll("ə", "e").replaceAll("ı", "i").replace(/[^\p{L}\p{N}]/gu, "");
}
export function importNameKey(value: string) { return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("az"); }
export function inferImportMapping(headers: string[]): ImportMapping {
  return Object.fromEntries(importFields.map(({ key }) => [key, headers.findIndex((header) => aliases[key].includes(headerKey(header)))])) as ImportMapping;
}
export function guessHeaderRow(data: string[][]): number {
  let best = 0, bestScore = -1;
  for (let index = 0; index < Math.min(data.length, 30); index++) {
    const mapping = inferImportMapping(data[index]);
    const score = Object.values(mapping).filter((column) => column >= 0).length + (mapping.name >= 0 ? 2 : 0) + (mapping.price >= 0 ? 2 : 0);
    if (score > bestScore) { best = index; bestScore = score; }
  }
  return best;
}
export function parseImportPrice(value: string): string | null {
  const compact = value.trim().replace(/\s+/g, "").replace(/(?:AZN|₼|manat)$/i, "").replace(',', '.').replace(/^\./, '0.').replace(/^0+(?=\d)/, '');
  return parseMenuPrice(compact);
}
export function importMappingError(mapping: ImportMapping): string {
  if (mapping.name < 0 || mapping.price < 0) return "Məhsul adı və qiymət sütunlarını seç.";
  const mapped = Object.values(mapping).filter((column) => column >= 0);
  return new Set(mapped).size !== mapped.length ? "Hər məlumat üçün ayrı sütun seç." : "";
}
export function reviewImportRows({ data, headerRow, mapping, fallbackCategory, overrides, excluded, mode, categories, products }: {
  data: string[][]; headerRow: number; mapping: ImportMapping; fallbackCategory: string;
  overrides: Record<number, Partial<ImportRow>>; excluded: number[]; mode: ImportMode; categories: MenuCategory[]; products: MenuProduct[];
}): ReviewRow[] {
  const categoryMap = new Map<string, MenuCategory[]>(), productMap = new Map<string, MenuProduct[]>();
  for (const category of categories) { const key = importNameKey(category.name); categoryMap.set(key, [...(categoryMap.get(key) || []), category]); }
  for (const product of products) { const key = `${product.category_id}|${importNameKey(product.name)}`; productMap.set(key, [...(productMap.get(key) || []), product]); }
  const skipped = new Set(excluded);
  const rows: ReviewRow[] = [];
  for (let index = headerRow + 1; index < data.length; index++) {
    if (data[index].every((cell) => !cell.trim())) continue;
    const raw = Object.fromEntries(importFields.map(({ key }) => [key, (mapping[key] < 0 ? "" : data[index][mapping[key]] || "").trim()])) as ImportRow;
    raw.category ||= fallbackCategory.trim();
    const values = { ...raw, ...overrides[index] };
    for (const key of Object.keys(values) as ImportField[]) values[key] = values[key].trim();
    const errors: string[] = [], notes: string[] = [];
    if (!values.category || values.category.length > 150) errors.push("Kateqoriya adı 1–150 simvol olmalıdır.");
    if (!values.name || values.name.length > 150) errors.push("Məhsul adı 1–150 simvol olmalıdır.");
    const price = parseImportPrice(values.price);
    if (price === null) errors.push("Qiyməti 5 və ya 5,50 kimi yaz.");
    if (values.description.length > 2000) errors.push("Təsvir 2000 simvoldan uzun ola bilməz.");
    if (!isMenuImageUrl(values.image_url)) errors.push("Şəkil üçün düzgün HTTPS keçidi yaz.");
    const matchingCategories = categoryMap.get(importNameKey(values.category)) || [];
    if (matchingCategories.length > 1) errors.push("Restoranda bu adda bir neçə kateqoriya var. Kateqoriya adlarını fərqləndir.");
    const category = matchingCategories[0];
    const matchingProducts = category ? productMap.get(`${category.id}|${importNameKey(values.name)}`) || [] : [];
    if (matchingProducts.length > 1) errors.push("Bu kateqoriyada eyni adda bir neçə məhsul var. Adlarını fərqləndir.");
    if (category && !category.is_active) notes.push("Kateqoriya aktiv deyil.");
    if (matchingProducts[0] && !matchingProducts[0].is_active) notes.push("Mövcud məhsul aktiv deyil.");
    rows.push({ rowNumber: index + 1, values: { ...values, price: price ?? values.price }, excluded: skipped.has(index + 1), errors,
      action: matchingProducts.length === 0 ? "new" : mode, notes });
  }
  const occurrences = new Map<string, ReviewRow[]>();
  for (const row of rows.filter((row) => !row.excluded)) {
    const key = JSON.stringify([importNameKey(row.values.category), importNameKey(row.values.name)]);
    occurrences.set(key, [...(occurrences.get(key) || []), row]);
  }
  for (const repeated of occurrences.values()) if (repeated.length > 1) for (const row of repeated) row.errors.push("Faylda bu məhsul təkrarlanır. Artıq sətirlərin işarəsini götür.");
  return rows;
}
