import { MAX_IMPORT_ROWS, type ImportSheet } from "./menu-import";

function cells(data: unknown[][]): string[][] {
  return data.map((row) => row.map((cell) => cell == null ? "" : cell instanceof Date ? cell.toISOString() : String(cell)));
}
export async function readMenuFile(file: File): Promise<ImportSheet[]> {
  if (file.size === 0 || file.size > 5 * 1024 * 1024) throw new Error("Fayl boş olmamalı və 5 MB-dan böyük olmamalıdır.");
  const extension = file.name.split('.').pop()?.toLowerCase();
  let sheets: ImportSheet[];
  if (extension === "xlsx") {
    const { default: readExcelFile } = await import("read-excel-file/browser");
    const result = await readExcelFile(file);
    sheets = result.map((sheet) => ({ name: sheet.sheet, data: cells(sheet.data) }));
  } else if (extension === "csv") {
    const { default: Papa } = await import("papaparse");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? "utf-16le" : bytes[0] === 0xfe && bytes[1] === 0xff ? "utf-16be" : "utf-8";
    let text: string;
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
    catch { throw new Error("CSV faylını UTF-8 formatında saxla və yenidən seç."); }
    const parsed = Papa.parse<string[]>(text, { header: false, dynamicTyping: false, skipEmptyLines: false, preview: MAX_IMPORT_ROWS + 102 });
    if (parsed.errors.some((error) => error.type !== "Delimiter")) throw new Error("CSV-də dırnaqlar və sütun ayırıcıları düzgün deyil. Faylı Excel-dən yenidən CSV kimi saxla.");
    if (parsed.meta.truncated) throw new Error(`Bir faylda ən çox ${MAX_IMPORT_ROWS} məhsul ola bilər. Böyük menyunu hissələrə böl.`);
    sheets = [{ name: file.name, data: parsed.data }];
  } else throw new Error("Excel (.xlsx) və ya CSV faylı seç.");
  sheets = sheets.filter((sheet) => sheet.data.some((row) => row.some((cell) => cell.trim())));
  if (!sheets.length) throw new Error("Faylda menyu məlumatı tapılmadı.");
  for (const sheet of sheets) {
    if (sheet.data.length > 5000 || sheet.data.some((row) => row.length > 100)) throw new Error("Fayl çox böyükdür. Menyu sütunlarını ayrıca faylda saxla.");
  }
  return sheets;
}
