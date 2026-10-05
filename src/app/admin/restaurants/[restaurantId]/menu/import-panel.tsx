"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readMenuFile } from "@/lib/read-menu-file";
import { guessHeaderRow, importFields, importMappingError, inferImportMapping, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, reviewImportRows,
  type ImportField, type ImportMapping, type ImportMode, type ImportResult, type ImportRow, type ImportSheet } from "@/lib/menu-import";
import type { MenuCategory, MenuProduct } from "@/lib/menu-management";

const input = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100";
const emptyMapping: ImportMapping = { category: -1, name: -1, price: -1, description: -1, image_url: -1 };

export default function MenuImportPanel({ restaurantId, categories, products }: { restaurantId: string; categories: MenuCategory[]; products: MenuProduct[] }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<ImportSheet[]>([]), [sheetIndex, setSheetIndex] = useState(0), [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping), [fallback, setFallback] = useState("Ümumi"), [mode, setMode] = useState<ImportMode>("skip");
  const [overrides, setOverrides] = useState<Record<number, Partial<ImportRow>>>({}), [excluded, setExcluded] = useState<number[]>([]), [page, setPage] = useState(0);
  const [fileName, setFileName] = useState(""), [pending, setPending] = useState(false), [reading, setReading] = useState(false), [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const request = useRef<{ signature: string; id: string } | null>(null), busy = useRef(false);
  const sheet = sheets[sheetIndex];
  const rows = sheet ? reviewImportRows({ data: sheet.data, headerRow, mapping, fallbackCategory: fallback, overrides, excluded, mode, categories, products }) : [];
  const included = rows.filter((row) => !row.excluded), invalid = included.filter((row) => row.errors.length);
  const mappingError = sheet ? importMappingError(mapping) : "";
  const tooMany = included.length > MAX_IMPORT_ROWS;
  const pageCount = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const disabled = pending || !!result;

  function configureSheet(list: ImportSheet[], index: number) {
    const header = guessHeaderRow(list[index].data);
    setSheetIndex(index); setHeaderRow(header); setMapping(inferImportMapping(list[index].data[header] || []));
    setOverrides({}); setExcluded([]); setPage(0); setMessage(""); setResult(null); request.current = null;
  }
  async function selectFile(file?: File) {
    if (!file || busy.current) return;
    setReading(true); setMessage(""); setResult(null); setSheets([]); setFileName(file.name);
    try { const list = await readMenuFile(file); setSheets(list); configureSheet(list, 0); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Fayl oxunmadı. Excel və ya CSV kimi yenidən saxla."); }
    finally { setReading(false); }
  }
  function editRow(rowNumber: number, field: ImportField, value: string) {
    setOverrides((current) => ({ ...current, [rowNumber - 1]: { ...current[rowNumber - 1], [field]: value } }));
    setMessage("");
  }
  async function runImport() {
    if (busy.current || result || mappingError || invalid.length || !included.length || tooMany) return;
    const items = included.map((row) => row.values);
    const serialized = JSON.stringify(items);
    if (new TextEncoder().encode(serialized).length > MAX_IMPORT_BYTES) { setMessage("Menyu məlumatı çox böyükdür. Təsvirləri qısalt və ya faylı hissələrə böl."); return; }
    const signature = JSON.stringify({ mode, items });
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    busy.current = true; setPending(true); setMessage("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("import_restaurant_menu", { p_restaurant_id: restaurantId,
        p_request_id: request.current.id, p_mode: mode, p_rows: items }).abortSignal(controller.signal);
      if (error) {
        setMessage(error.code === "PGRST202" ? "İmport üçün 012_menu_import.sql faylını Supabase-də işlət."
          : error.code === "42501" ? "Bu restoranın menyusunu import etmək üçün icazən yoxdur."
          : error.code === "P0001" ? error.message : "İmport cavabı alınmadı. Yenidən cəhd et; təkrar məhsul yaradılmayacaq.");
        return;
      }
      if (!data) { setMessage("İmport cavabı alınmadı. Yenidən cəhd et."); return; }
      setResult(data as ImportResult); router.refresh();
    } catch { setMessage("Bağlantı alınmadı. Yenidən cəhd et; eyni import təkrarlanmayacaq."); }
    finally { window.clearTimeout(timeout); busy.current = false; setPending(false); }
  }

  return <section className="space-y-5 rounded-2xl border border-emerald-200 bg-white p-5">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">Menyu import et</h2><p className="mt-1 text-sm text-slate-600">Excel və ya CSV faylından məhsulları toplu əlavə et. Kateqoriyalar avtomatik yaranır.</p></div>
      <div className="flex flex-wrap gap-3 text-sm font-medium text-emerald-700"><a href="/menyu-numune.xlsx" download className="hover:underline">Nümunə Excel endir</a><a href="/menyu-numune.csv" download className="hover:underline">Nümunə CSV endir</a></div>
    </div>
    <label className="block text-sm font-medium">Menyu faylı<input type="file" accept=".xlsx,.csv" disabled={pending || reading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); }} className="mt-2 block w-full rounded-xl border border-slate-300 p-3 text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-emerald-700" /></label>
    <p className="text-xs text-slate-500">Excel (.xlsx) və ya CSV. Ən çox 5 MB və bir importda {MAX_IMPORT_ROWS} məhsul. Şəkil sütununda açıq HTTPS şəkil keçidi olmalıdır.</p>
    {reading && <p role="status" className="text-sm text-emerald-700">Fayl oxunur...</p>}
    {message && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{message}</p>}
    {result && <div role="status" className="space-y-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">İmport tamamlandı.</p><p>{result.categories_created} yeni kateqoriya · {result.products_created} yeni məhsul · {result.products_updated} yenilənən məhsul · {result.products_skipped} keçilən məhsul.</p><p>Yeni fayl seçərək başqa məhsullar da əlavə edə bilərsən.</p></div>}
    {sheet && !result && <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Excel səhifəsi<select aria-label="Excel səhifəsi" disabled={disabled} value={sheetIndex} onChange={(event) => configureSheet(sheets, Number(event.target.value))} className={`${input} mt-1`}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label>
        <label className="block text-sm font-medium">Başlıq sətri<select aria-label="Başlıq sətri" disabled={disabled} value={headerRow} onChange={(event) => { const index = Number(event.target.value); setHeaderRow(index); setMapping(inferImportMapping(sheet.data[index] || [])); setOverrides({}); setExcluded([]); setPage(0); }} className={`${input} mt-1`}>{sheet.data.slice(0, Math.min(sheet.data.length, 100)).map((row, index) => <option key={index} value={index}>{index + 1}: {row.filter(Boolean).slice(0, 3).join(" / ").slice(0, 100) || "Boş sətir"}</option>)}</select></label>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{importFields.map((field) => <label key={field.key} className="block text-sm font-medium">{field.label}{field.required ? " *" : ""}<select aria-label={`${field.label} sütunu`} disabled={disabled} value={mapping[field.key]} onChange={(event) => { setMapping((current) => ({ ...current, [field.key]: Number(event.target.value) })); setOverrides({}); setPage(0); }} className={`${input} mt-1`}><option value={-1}>{field.required ? "Sütun seç" : "Sütun yoxdur"}</option>{(sheet.data[headerRow] || []).map((header, index) => <option key={index} value={index}>{index + 1}. {header || "Adsız sütun"}</option>)}</select></label>)}</div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium">Boş kateqoriyalar üçün ad<input disabled={disabled} value={fallback} onChange={(event) => setFallback(event.target.value)} maxLength={150} className={`${input} mt-1`} /></label>
        <label className="block text-sm font-medium">Mövcud məhsul tapılanda<select aria-label="Mövcud məhsul tapılanda" disabled={disabled} value={mode} onChange={(event) => setMode(event.target.value as ImportMode)} className={`${input} mt-1`}><option value="skip">Keç — mövcud məlumatı saxla</option><option value="update">Qiymət, təsvir və şəkli yenilə</option></select></label>
      </div>
      <p className="text-xs text-slate-500">Eyni kateqoriyada eyni adlı məhsul mövcud sayılır. Yeniləmədə boş təsvir və şəkil əvvəlki məlumatı saxlayır. Filialın ayrıca qiyməti və mövcudluğu saxlanır.</p>
      {mappingError && <p role="alert" className="text-sm text-red-700">{mappingError}</p>}
      {tooMany && <p role="alert" className="text-sm text-red-700">{included.length} məhsul seçilib. Bir importda ən çox {MAX_IMPORT_ROWS} məhsul seç.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold">Önizləmə — {fileName}</h3><p className="mt-1 text-sm text-slate-600">{included.length} seçilmiş sətir · {invalid.length} səhv sətir. Aşağıdakı xanaları dəyişə bilərsən.</p></div><button type="button" disabled={disabled || !invalid.length} onClick={() => { setExcluded((current) => [...new Set([...current, ...invalid.map((row) => row.rowNumber)])]); setMessage(""); }} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">Səhv sətirləri keç</button></div>
      <div className="max-h-[600px] overflow-auto rounded-xl border border-slate-200"><table className="w-full min-w-[1040px] text-left text-sm"><thead className="sticky top-0 z-10 bg-slate-100"><tr><th className="p-3">Seç / sətir</th><th className="p-3">Kateqoriya</th><th className="p-3">Məhsul adı</th><th className="p-3">Qiymət</th><th className="p-3">Təsvir</th><th className="p-3">Şəkil keçidi</th><th className="p-3">Vəziyyət</th></tr></thead><tbody>{rows.slice(currentPage * 25, (currentPage + 1) * 25).map((row) => <tr key={row.rowNumber} className={`border-t border-slate-200 ${row.excluded ? "bg-slate-50 text-slate-400" : row.errors.length ? "bg-red-50" : "bg-white"}`}>
        <td className="p-3 align-top"><label className="flex items-center gap-2"><input type="checkbox" aria-label={`Sətir ${row.rowNumber} seç`} disabled={disabled} checked={!row.excluded} onChange={(event) => setExcluded((current) => event.target.checked ? current.filter((value) => value !== row.rowNumber) : [...current, row.rowNumber])} className="accent-emerald-600" />{row.rowNumber}</label></td>
        {importFields.map((field) => <td key={field.key} className="min-w-36 p-2 align-top"><input aria-label={`Sətir ${row.rowNumber}: ${field.label}`} disabled={disabled} value={row.values[field.key]} onChange={(event) => editRow(row.rowNumber, field.key, event.target.value)} inputMode={field.key === "price" ? "decimal" : undefined} className={input} /></td>)}
        <td className="min-w-56 p-3 align-top">{row.excluded ? "Keçiləcək" : row.errors.length ? row.errors.map((error) => <p key={error} className="mb-1 text-xs text-red-700">{error}</p>) : <p className="text-xs text-emerald-700">{row.action === "new" ? "Yeni məhsul" : row.action === "skip" ? "Mövcuddur, keçiləcək" : "Mövcuddur, yenilənəcək"}</p>}{row.notes.map((note) => <p key={note} className="mt-1 text-xs text-amber-700">{note}</p>)}</td>
      </tr>)}</tbody></table></div>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3 text-sm"><button disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">Əvvəlki</button><span>{currentPage + 1} / {pageCount}</span><button disabled={disabled || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} className="rounded-lg border border-slate-300 px-3 py-2 disabled:opacity-40">Sonrakı</button></div>
        <button type="button" disabled={disabled || !!mappingError || !!invalid.length || !included.length || tooMany} onClick={() => void runImport()} className="rounded-xl bg-emerald-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-40">{pending ? "İmport edilir..." : `${included.length} məhsulu import et`}</button>
      </div>
    </>}
  </section>;
}
