"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readMenuFile } from "@/lib/read-menu-file";
import { uploadImportPhoto } from "@/lib/import-menu-photo";
import { guessHeaderRow, importFields, importMappingError, inferImportMapping, MAX_IMPORT_BYTES, MAX_IMPORT_ROWS, reviewImportRows,
  type ImportField, type ImportImage, type ImportMapping, type ImportMode, type ImportResult, type ImportRow, type ImportSheet } from "@/lib/menu-import";
import type { MenuCategory, MenuProduct } from "@/lib/menu-management";

const input = "min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2 text-base disabled:bg-slate-100";
const emptyMapping: ImportMapping = { category: -1, name: -1, price: -1, description: -1, image_url: -1 };

function ImagePreview({ file, rowNumber }: { file: File; rowNumber: number }) {
  const [preview, setPreview] = useState<{ file: File; url: string; error: string } | null>(null);
  useEffect(() => {
    let active = true, url = "";
    void createImageBitmap(file).then((bitmap) => {
      bitmap.close();
      if (active) { url = URL.createObjectURL(file); setPreview({ file, url, error: "" }); }
    }).catch(() => { if (active) setPreview({ file, url: "", error: "Şəkil açılmadı. Başqa şəkil seç." }); });
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  if (preview?.file !== file) return <span className="text-xs text-slate-500">Şəkil oxunur...</span>;
  return preview.url ? <Image unoptimized src={preview.url} width={72} height={56} alt={`Sətir ${rowNumber} şəkli`} className="h-14 w-18 rounded-lg object-cover" /> : <span className="text-xs text-red-700">{preview.error}</span>;
}

function rowImage(sheet: ImportSheet | undefined, rowNumber: number, column: number): ImportImage | undefined {
  const images = (sheet?.images || []).filter((image) => image.rowNumber === rowNumber && (column < 0 || image.column === column));
  return images.length > 1 ? { rowNumber, column, error: "Bu sətirdə bir neçə şəkil var. Şəkil sütununu seç və ya aşağıdan doğru şəkli seç." } : images[0];
}

export default function MenuImportPanel({ restaurantId, categories, products, onBusy, onDone }: { restaurantId: string; categories: MenuCategory[]; products: MenuProduct[]; onBusy?: (busy: boolean) => void; onDone?: () => void }) {
  const router = useRouter();
  const [sheets, setSheets] = useState<ImportSheet[]>([]), [sheetIndex, setSheetIndex] = useState(0), [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ImportMapping>(emptyMapping), [fallback, setFallback] = useState("Ümumi"), [mode, setMode] = useState<ImportMode>("skip");
  const [overrides, setOverrides] = useState<Record<number, Partial<ImportRow>>>({}), [excluded, setExcluded] = useState<number[]>([]), [page, setPage] = useState(0);
  const [fileName, setFileName] = useState(""), [pending, setPending] = useState(false), [reading, setReading] = useState(false), [message, setMessage] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [customImages, setCustomImages] = useState<Record<number, File>>({}), [ignoredImages, setIgnoredImages] = useState<number[]>([]);
  const [progress, setProgress] = useState(""), [uploadedCount, setUploadedCount] = useState(0);
  useEffect(() => { onBusy?.(pending || reading); }, [pending, reading, onBusy]);
  const uploadedImages = useRef(new Map<File, string>());
  const request = useRef<{ signature: string; id: string } | null>(null), busy = useRef(false);
  const sheet = sheets[sheetIndex];
  const rows = (sheet ? reviewImportRows({ data: sheet.data, headerRow, mapping, fallbackCategory: fallback, overrides, excluded, mode, categories, products }) : []).map((row) => {
    const candidate = rowImage(sheet, row.rowNumber, mapping.image_url);
    const image = customImages[row.rowNumber] ? { rowNumber: row.rowNumber, column: mapping.image_url, file: customImages[row.rowNumber] } : candidate;
    const useImage = !ignoredImages.includes(row.rowNumber) && !row.values.image_url;
    return { ...row, image, useImage, errors: useImage && image?.error ? [...row.errors, image.error] : row.errors };
  });
  const included = rows.filter((row) => !row.excluded), invalid = included.filter((row) => row.errors.length);
  const mappingError = sheet ? importMappingError(mapping) : "";
  const tooMany = included.length > MAX_IMPORT_ROWS;
  const pageCount = Math.max(1, Math.ceil(rows.length / 25));
  const currentPage = Math.min(page, pageCount - 1);
  const disabled = pending || !!result;
  const imagesToUpload = included.filter((row) => row.action !== "skip" && row.useImage && row.image?.file);
  const skippedImages = included.filter((row) => row.action === "skip" && (row.useImage && row.image?.file || row.values.image_url)).length;
  const unmatchedImages = sheet?.images?.filter((image) => image.rowNumber > headerRow + 1 && !rows.some((row) => row.rowNumber === image.rowNumber && (mapping.image_url < 0 || mapping.image_url === image.column))).length || 0;

  function configureSheet(list: ImportSheet[], index: number) {
    const header = guessHeaderRow(list[index].data);
    setSheetIndex(index); setHeaderRow(header); setMapping(inferImportMapping(list[index].data[header] || []));
    setOverrides({}); setExcluded([]); setPage(0); setMessage(""); setResult(null); request.current = null;
    setCustomImages({}); setIgnoredImages([]); uploadedImages.current.clear();
  }
  async function selectFile(file?: File) {
    if (!file || busy.current || reading) return;
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
    busy.current = true; setPending(true); setMessage(""); setProgress(""); setUploadedCount(0);
    let timeout: number | undefined;
    try {
      const supabase = createClient();
      const reservedUrl = supabase.storage.from("menu-images").getPublicUrl(`${restaurantId.toLowerCase()}/00000000-0000-4000-8000-000000000000.webp`).data.publicUrl;
      const estimated = included.map((row) => ({ ...row.values, image_url: row.action !== "skip" && row.useImage && row.image?.file ? reservedUrl : row.values.image_url }));
      if (new TextEncoder().encode(JSON.stringify(estimated)).length + included.length * 10 > MAX_IMPORT_BYTES) throw new Error("Menyu məlumatı çox böyükdür. Təsvirləri qısalt və ya faylı hissələrə böl.");
      let done = 0, next = 0;
      let failure: Error | undefined;
      const uploads = new Map<File, Promise<string>>();
      async function worker() {
        while (!failure && next < imagesToUpload.length) {
          const row = imagesToUpload[next++], file = row.image!.file!;
          setProgress(`Şəkillər yüklənir: ${done} / ${imagesToUpload.length}`);
          try {
            if (!uploadedImages.current.has(file)) {
              let upload = uploads.get(file);
              if (!upload) { upload = uploadImportPhoto(supabase, restaurantId, file); uploads.set(file, upload); }
              uploadedImages.current.set(file, await upload);
            }
            done++; setUploadedCount(done);
            setProgress(`Şəkillər yüklənir: ${done} / ${imagesToUpload.length}`);
          } catch (error) { failure = new Error(`Sətir ${row.rowNumber}: ${error instanceof Error ? error.message : "Şəkil yüklənmədi."}`); }
        }
      }
      await Promise.all([worker(), worker()]);
      if (failure) throw failure;
      const items = included.map((row) => ({ ...row.values, image_url: row.action !== "skip" && row.useImage && row.image?.file ? uploadedImages.current.get(row.image.file)! : row.values.image_url }));
      if (new TextEncoder().encode(JSON.stringify(items)).length + included.length * 10 > MAX_IMPORT_BYTES) throw new Error("Menyu məlumatı çox böyükdür. Təsvirləri qısalt və ya faylı hissələrə böl.");
      const signature = JSON.stringify({ mode, items });
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      setProgress("Məhsullar əlavə olunur...");
      const controller = new AbortController();
      timeout = window.setTimeout(() => controller.abort(), 45000);
      const { data, error } = await supabase.rpc("import_restaurant_menu", { p_restaurant_id: restaurantId,
        p_request_id: request.current.id, p_mode: mode, p_rows: items }).abortSignal(controller.signal);
      if (error) {
        setMessage(error.code === "PGRST202" ? "Menyu yükləmə yeniləməsi tətbiq edilməyib. Platforma admininə xəbər ver."
          : error.code === "42501" ? "Bu restoranın menyusunu import etmək üçün icazən yoxdur."
          : error.code === "P0001" ? error.message : "İmport cavabı alınmadı. Yenidən cəhd et; təkrar məhsul yaradılmayacaq.");
        return;
      }
      if (!data) { setMessage("İmport cavabı alınmadı. Yenidən cəhd et."); return; }
      setResult(data as ImportResult); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Bağlantı alınmadı. Yenidən cəhd et; eyni import təkrarlanmayacaq."); }
    finally { if (timeout !== undefined) window.clearTimeout(timeout); busy.current = false; setPending(false); setProgress(""); }
  }

  return <section className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6" aria-busy={pending || reading}>
    <header><h2 className="text-xl font-bold">Menyunu fayldan yüklə</h2><p className="mt-2 text-sm leading-6 text-slate-600">1. Faylı seç → 2. Məhsulları yoxla → 3. Menyuya əlavə et</p></header>
    <details open={!sheet || !!result} className="rounded-xl bg-slate-50 p-4"><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold">{sheet && !result ? `${fileName} · Faylı dəyiş` : "1. Menyu faylını seç"}</summary><label className="mt-3 block text-sm font-semibold">Excel və ya CSV faylı<input type="file" accept=".xlsx,.csv" disabled={pending || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; void selectFile(file); }} className="mt-3 block w-full min-w-0 text-sm file:mr-3 file:rounded-xl file:border-0 file:bg-emerald-800 file:px-4 file:py-3 file:font-semibold file:text-white" /></label>
      <p className="mt-3 text-xs leading-5 text-slate-500">Excel: 25 MB · CSV: 5 MB · Bir dəfəyə {MAX_IMPORT_ROWS} məhsul. Kateqoriyalar avtomatik yaranır.</p>
      <div className="mt-3 flex flex-wrap gap-4 text-sm font-semibold text-emerald-800"><a href="/menyu-numune.xlsx" download className="inline-flex min-h-11 items-center">Nümunə Excel endir</a><a href="/menyu-numune.csv" download className="inline-flex min-h-11 items-center">Nümunə CSV endir</a></div>
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Məhsul şəkillərini necə əlavə edim?</summary><p className="pb-3 text-sm leading-6 text-slate-600">Excel-də “Şəkil” sütunu yarat və şəkli məhsulun öz sətrinə yerləşdir. Şəklin sol üst küncü həmin sətirdə olsun. Açıq HTTPS şəkil keçidi də yaza bilərsən. Faylda şəkil yoxdursa, aşağıdakı önizləmədən telefondakı və ya kompüterdəki şəkli seç.</p></details>
    </details>
    {reading && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800">Fayl oxunur…</p>}
    {progress && <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"><p>{progress}</p>{imagesToUpload.length > 0 && <progress aria-label="Şəkillərin yüklənməsi" max={imagesToUpload.length} value={uploadedCount} className="h-2 w-full accent-emerald-700"/>}<p className="text-xs">Yükləmə bitənə qədər bu səhifəni açıq saxla.</p></div>}
    {message && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{message}</p>}
    {result && <div role="status" className="space-y-3 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900"><h3 className="font-bold">Menyu yükləndi</h3><p>{result.products_created} yeni məhsul · {result.products_updated} yenilənən · {result.products_skipped} keçilən · {result.categories_created} yeni kateqoriya</p><button type="button" onClick={onDone} className="min-h-12 rounded-xl bg-emerald-800 px-5 py-3 font-semibold text-white">Məhsullara bax</button><p className="text-xs">Başqa məhsullar üçün yeni fayl seçə bilərsən.</p></div>}
    {sheet && !result && <>
      <details open={!!mappingError} className="rounded-xl border border-slate-200 p-4"><summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">Fayl ayarları və mövcud məhsullar</summary><div className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium">Excel səhifəsi<select aria-label="Excel səhifəsi" disabled={disabled} value={sheetIndex} onChange={event => configureSheet(sheets, Number(event.target.value))} className={input}>{sheets.map((item, index) => <option key={index} value={index}>{item.name}</option>)}</select></label><label className="block space-y-2 text-sm font-medium">Başlıq sətri<select aria-label="Başlıq sətri" disabled={disabled} value={headerRow} onChange={event => { const index = Number(event.target.value); setHeaderRow(index); setMapping(inferImportMapping(sheet.data[index] || [])); setOverrides({}); setExcluded([]); setPage(0); }} className={input}>{sheet.data.slice(0, 100).map((row, index) => <option key={index} value={index}>{index + 1}: {row.filter(Boolean).slice(0, 3).join(" / ").slice(0, 80) || "Boş sətir"}</option>)}</select></label></div>
        <div className="grid gap-3 sm:grid-cols-2">{importFields.map(field => <label key={field.key} className="block space-y-2 text-sm font-medium">{field.label}{field.required ? " *" : ""}<select aria-label={`${field.label} sütunu`} disabled={disabled} value={mapping[field.key]} onChange={event => { setMapping(current => ({ ...current, [field.key]: Number(event.target.value) })); setOverrides({}); setPage(0); }} className={input}><option value={-1}>{field.required ? "Sütun seç" : field.key === "image_url" ? "Şəkli avtomatik seç" : "Sütun yoxdur"}</option>{(sheet.data[headerRow] || []).map((header, index) => <option key={index} value={index}>{index + 1}. {header || "Adsız sütun"}</option>)}</select></label>)}</div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block space-y-2 text-sm font-medium">Boş kateqoriyalar üçün ad<input disabled={disabled} value={fallback} onChange={event => setFallback(event.target.value)} maxLength={150} className={input}/></label><label className="block space-y-2 text-sm font-medium">Mövcud məhsul tapılanda<select aria-label="Mövcud məhsul tapılanda" disabled={disabled} value={mode} onChange={event => setMode(event.target.value as ImportMode)} className={input}><option value="skip">Keç — mövcud məlumatı saxla</option><option value="update">Qiymət, təsvir və şəkli yenilə</option></select></label></div><p className="text-xs leading-5 text-slate-500">Eyni kateqoriyada eyni adlı məhsul mövcud sayılır. Yeniləmədə boş təsvir və şəkil əvvəlki məlumatı saxlayır. Filial qiymətləri və mövcudluğu dəyişmir.</p>
      </div></details>
      {skippedImages > 0 && <p className="rounded-xl bg-amber-50 p-4 text-sm leading-6 text-amber-800">{skippedImages} mövcud məhsulun şəkli keçiləcək. Şəkillərini də yeniləmək üçün “Fayl ayarları”nda “Qiymət, təsvir və şəkli yenilə” seç.</p>}
      {(unmatchedImages > 0 || !!sheet.imageWarnings?.length) && <p role="alert" className="rounded-xl bg-amber-50 p-4 text-sm text-amber-800">{unmatchedImages > 0 ? `${unmatchedImages} şəkil məhsul sətirləri ilə uyğunlaşmadı. Fayl ayarlarından şəkil sütununu seç və önizləməni yoxla. ` : ""}{[...new Set(sheet.imageWarnings || [])].join(" ")}</p>}
      {mappingError && <p role="alert" className="text-sm text-red-700">{mappingError}</p>}
      {tooMany && <p role="alert" className="text-sm text-red-700">{included.length} məhsul seçilib. Bir dəfəyə ən çox {MAX_IMPORT_ROWS} məhsul seç.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="break-all font-bold">Məhsulları yoxla — {fileName}</h3><p className="mt-2 text-sm text-slate-500">{included.length} seçilib · {invalid.length} səhv sətir · {imagesToUpload.length} şəkil</p></div>{invalid.length > 0 && <button type="button" disabled={disabled} onClick={() => { setExcluded(current => [...new Set([...current, ...invalid.map(row => row.rowNumber)])]); setMessage(""); }} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm disabled:opacity-40">Səhv sətirləri keç</button>}</div>
      <div className="grid items-start gap-3 xl:grid-cols-2">{rows.slice(currentPage * 25, (currentPage + 1) * 25).map(row => <article key={row.rowNumber} aria-label={`Sətir ${row.rowNumber}`} className={`min-w-0 space-y-4 rounded-xl border p-4 ${row.excluded ? "border-slate-200 bg-slate-50 opacity-60" : row.errors.length ? "border-red-200 bg-red-50/30" : "border-slate-200"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2"><label className="flex min-h-11 items-center gap-3 text-sm font-semibold"><input type="checkbox" aria-label={`Sətir ${row.rowNumber} seç`} disabled={disabled} checked={!row.excluded} onChange={event => setExcluded(current => event.target.checked ? current.filter(value => value !== row.rowNumber) : [...current, row.rowNumber])} className="h-5 w-5 accent-emerald-700"/>Sətir {row.rowNumber}</label><span className={`text-xs ${row.errors.length ? "text-red-700" : "text-emerald-800"}`}>{row.excluded ? "Keçiləcək" : row.errors.length ? "Düzəliş lazımdır" : row.action === "new" ? "Yeni məhsul" : row.action === "skip" ? "Mövcuddur, keçiləcək" : "Yenilənəcək"}</span></div>
        <div className="grid gap-3 sm:grid-cols-[1fr_100px]">{(["name", "price", "category"] as const).map(field => <label key={field} className={`block min-w-0 space-y-2 text-sm ${field === "category" ? "sm:col-span-2" : ""}`}>{importFields.find(item => item.key === field)!.label}<input aria-label={`Sətir ${row.rowNumber}: ${importFields.find(item => item.key === field)!.label}`} disabled={disabled} value={row.values[field]} onChange={event => editRow(row.rowNumber, field, event.target.value)} inputMode={field === "price" ? "decimal" : undefined} className={input}/></label>)}</div>
        <div className="flex flex-wrap items-center gap-3">{row.image?.file && <ImagePreview file={row.image.file} rowNumber={row.rowNumber}/>}<label className="block min-w-0 flex-1 text-sm font-medium">Şəkil seç<input aria-label={`Sətir ${row.rowNumber} üçün şəkil seç`} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" disabled={disabled} className="mt-2 block min-h-11 w-full min-w-0 text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-3" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) { setCustomImages(current => ({ ...current, [row.rowNumber]: file })); setIgnoredImages(current => current.filter(value => value !== row.rowNumber)); editRow(row.rowNumber, "image_url", ""); } }}/></label></div>
        {row.image && <label className="flex min-h-11 items-center gap-3 text-sm"><input aria-label={`Sətir ${row.rowNumber} şəklini istifadə et`} type="checkbox" disabled={disabled || !!row.values.image_url} checked={!ignoredImages.includes(row.rowNumber)} onChange={event => setIgnoredImages(current => event.target.checked ? current.filter(value => value !== row.rowNumber) : [...current, row.rowNumber])} className="h-5 w-5 accent-emerald-700"/>Bu şəkli istifadə et</label>}
        <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Təsvir və şəkil keçidi</summary><div className="space-y-3 pt-2">{(["description", "image_url"] as const).map(field => <label key={field} className="block space-y-2 text-sm">{importFields.find(item => item.key === field)!.label}<input aria-label={`Sətir ${row.rowNumber}: ${importFields.find(item => item.key === field)!.label}`} disabled={disabled} value={row.values[field]} onChange={event => editRow(row.rowNumber, field, event.target.value)} className={input}/></label>)}{row.values.image_url && <p className="text-xs text-slate-500">Yazılmış keçid istifadə olunacaq.</p>}</div></details>
        {!row.excluded && row.errors.map(error => <p key={error} className="text-xs leading-5 text-red-700">{error}</p>)}{row.notes.map(note => <p key={note} className="text-xs leading-5 text-amber-800">{note}</p>)}
      </article>)}</div>
      {pageCount > 1 && <div className="flex flex-wrap items-center justify-center gap-3 text-sm"><button type="button" disabled={disabled || currentPage === 0} onClick={() => setPage(currentPage - 1)} className="min-h-11 rounded-xl border px-3 py-2 disabled:opacity-40">Əvvəlki</button><span>{currentPage + 1} / {pageCount}</span><button type="button" disabled={disabled || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)} className="min-h-11 rounded-xl border px-3 py-2 disabled:opacity-40">Sonrakı</button></div>}
      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:-mx-6 sm:px-6"><p className="text-sm text-slate-600">{invalid.length ? `${invalid.length} sətirdə səhvi düzəlt və ya həmin sətirləri keç.` : `${included.length} məhsul əlavə etməyə hazırdır.`}</p><button type="button" disabled={disabled || !!mappingError || !!invalid.length || !included.length || tooMany} onClick={() => void runImport()} className="min-h-12 w-full rounded-xl bg-emerald-800 px-5 py-3 text-sm font-semibold text-white disabled:opacity-40 sm:w-auto">{pending ? "Yüklənir…" : `${included.length} məhsulu menyuya əlavə et`}</button></div>
    </>}
  </section>;
}
