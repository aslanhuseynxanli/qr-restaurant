import { unzipSync, strFromU8 } from "fflate";
import type { ImportImage } from "./menu-import";

type ImageSheet = { images: ImportImage[]; warnings: string[]; urls: { rowNumber: number; column: number; url: string }[] };
type Relationship = { path: string; type: string; external: boolean };
const MAX_UNPACKED = 100 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024;

function descendants(node: Document | Element, name: string): Element[] {
  return Array.from(node.getElementsByTagNameNS("*", name));
}
function children(node: Element | undefined, name: string): Element[] {
  return node ? Array.from(node.children).filter((child) => child.localName === name) : [];
}
function relationId(node: Element, name = "id") {
  return Array.from(node.attributes).find((attribute) => attribute.localName === name && attribute.namespaceURI?.endsWith("/relationships"))?.value || "";
}
function integer(value?: string | null) { return value && /^\d+$/.test(value) ? Number(value) : -1; }
function resolvePart(from: string, target: string) {
  let decoded = target;
  try { decoded = decodeURIComponent(target); } catch { /* Use literal part name. */ }
  const parts: string[] = [];
  for (const item of (decoded.startsWith("/") ? decoded.slice(1) : from.slice(0, from.lastIndexOf("/") + 1) + decoded).split("/")) {
    if (item === "..") parts.pop(); else if (item && item !== ".") parts.push(item);
  }
  return parts.join("/");
}
function cellPosition(address: string | null) {
  const match = address?.match(/^([A-Z]+)([1-9]\d*)$/);
  if (!match) return null;
  let column = 0;
  for (const char of match[1]) column = column * 26 + char.charCodeAt(0) - 64;
  return { rowNumber: Number(match[2]), column: column - 1 };
}
function imageType(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "image/png";
  const prefix = String.fromCharCode(...bytes.slice(0, 12));
  if (prefix.startsWith("RIFF") && prefix.slice(8) === "WEBP") return "image/webp";
  if (prefix.startsWith("GIF87a") || prefix.startsWith("GIF89a")) return "image/gif";
  if (prefix.startsWith("BM")) return "image/bmp";
  return null;
}

// Relationships and XML coordinates are authoritative: media filenames alone do
// not identify a product, and an image's row/column are zero-based in drawings.
export async function readExcelImages(file: File): Promise<Map<string, ImageSheet>> {
  let unpacked = 0, entries = 0;
  const files = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
    if (++entries > 10000 || (unpacked += entry.originalSize) > MAX_UNPACKED) throw new Error("Excel faylı çox böyükdür. Menyunu kiçik fayllara böl.");
    return /\.(xml|rels)$/i.test(entry.name) || /\/media\//i.test(entry.name);
  } });
  const documents = new Map<string, Document>();
  function xml(part: string): Document | undefined {
    if (!files[part]) return;
    if (!documents.has(part)) {
      const document = new DOMParser().parseFromString(strFromU8(files[part]), "application/xml");
      if (descendants(document, "parsererror").length) throw new Error("Excel faylının şəkil məlumatı oxunmadı. Faylı yenidən .xlsx kimi saxla.");
      documents.set(part, document);
    }
    return documents.get(part);
  }
  function relationships(part: string) {
    const slash = part.lastIndexOf("/");
    const document = xml(part.slice(0, slash + 1) + "_rels/" + part.slice(slash + 1) + ".rels");
    return new Map<string, Relationship>((document ? descendants(document, "Relationship") : []).map((rel) => [rel.getAttribute("Id") || "", {
      path: resolvePart(part, rel.getAttribute("Target") || ""), type: rel.getAttribute("Type") || "", external: rel.getAttribute("TargetMode") === "External",
    }]));
  }
  const rootRelations = relationships("");
  const workbookPart = [...rootRelations.values()].find((rel) => rel.type.endsWith("/officeDocument") && !rel.external)?.path || "xl/workbook.xml";
  const workbook = xml(workbookPart);
  if (!workbook) throw new Error("Excel kitabı tapılmadı. .xlsx faylı seç.");
  const bookRelations = relationships(workbookPart);
  const photoFiles = new Map<string, { file?: File; error?: string }>();
  function photo(part?: string) {
    if (!part || !files[part]) return { error: "Excel-də şəkilin faylı tapılmadı. Şəkli kompüterdən yenidən əlavə et." };
    if (!photoFiles.has(part)) {
      const bytes = files[part], type = imageType(bytes);
      photoFiles.set(part, !type ? { error: "Bu şəkil formatı dəstəklənmir. JPG və ya PNG ilə əvəz et." }
        : bytes.byteLength > MAX_IMAGE ? { error: "Bir şəkil ən çox 5 MB ola bilər." }
        : { file: new File([new Uint8Array(bytes)], part.split("/").pop() || "photo", { type }) });
    }
    return photoFiles.get(part)!;
  }
  function findRichRoot(name: string) {
    for (const part of Object.keys(files).filter((path) => /\/richData\/.*\.xml$/i.test(path))) {
      const document = xml(part);
      if (document?.documentElement.localName === name) return { part, document };
    }
  }
  const values = findRichRoot("rvData"), structures = findRichRoot("rvStructures"), richRels = findRichRoot("richValueRels");
  const richImages: (string | undefined)[] = [];
  if (values && structures && richRels) {
    const types = children(structures.document.documentElement, "s");
    const links = children(richRels.document.documentElement, "rel"), rels = relationships(richRels.part);
    for (const value of children(values.document.documentElement, "rv")) {
      const structure = types[integer(value.getAttribute("s"))];
      const key = children(structure, "k").findIndex((item) => item.getAttribute("n") === "_rvRel:LocalImageIdentifier");
      const slot = key < 0 ? -1 : integer(children(value, "v")[key]?.textContent);
      const link = links[slot], rel = link ? rels.get(relationId(link)) : undefined;
      richImages.push(structure?.getAttribute("t") === "_localImage" && rel && !rel.external ? rel.path : undefined);
    }
  }
  const metadataPart = [...bookRelations.values()].find((rel) => rel.type.endsWith("/sheetMetadata") && !rel.external)?.path || "xl/metadata.xml";
  const metadata = xml(metadataPart);
  const metadataTypes = metadata ? children(descendants(metadata, "metadataTypes")[0], "metadataType") : [];
  const future = metadata ? descendants(metadata, "futureMetadata").find((item) => item.getAttribute("name") === "XLRICHVALUE") : undefined;
  const blocks = metadata ? children(descendants(metadata, "valueMetadata")[0], "bk") : [];
  const futureBlocks = children(future, "bk");
  const result = new Map<string, ImageSheet>();
  for (const item of descendants(workbook, "sheet")) {
    const sheetRel = bookRelations.get(relationId(item));
    if (!sheetRel || sheetRel.external) continue;
    const sheetXml = xml(sheetRel.path);
    if (!sheetXml) continue;
    const output: ImageSheet = { images: [], warnings: [], urls: [] };
    const sheetRelations = relationships(sheetRel.path);
    for (const drawingLink of descendants(sheetXml, "drawing")) {
      const drawingRel = sheetRelations.get(relationId(drawingLink));
      if (!drawingRel || drawingRel.external) { output.warnings.push("Excel-də bəzi şəkillər xarici fayla bağlıdır. Şəkli kompüterdən Excel-ə əlavə et."); continue; }
      const drawing = xml(drawingRel.path);
      if (!drawing) continue;
      const drawingRels = relationships(drawingRel.path);
      for (const anchor of Array.from(drawing.documentElement.children)) {
        const pictures = descendants(anchor, "pic");
        if (!pictures.length) continue;
        const from = children(anchor, "from")[0];
        const row = integer(children(from, "row")[0]?.textContent), column = integer(children(from, "col")[0]?.textContent);
        if (row < 0 || column < 0 || row >= 5000 || column >= 100) { output.warnings.push("Bəzi şəkillərin sətri müəyyən olunmadı. Onları məhsulun Şəkil xanasına yerləşdir."); continue; }
        for (const picture of pictures) {
          const blip = descendants(picture, "blip")[0];
          const imageRel = blip ? drawingRels.get(relationId(blip, "embed")) : undefined;
          output.images.push({ rowNumber: row + 1, column, ...photo(imageRel && !imageRel.external ? imageRel.path : undefined) });
        }
      }
    }
    for (const cell of descendants(sheetXml, "c")) {
      const position = cellPosition(cell.getAttribute("r"));
      if (!position || position.rowNumber > 5000 || position.column >= 100) continue;
      const vm = integer(cell.getAttribute("vm"));
      const block = blocks[vm - 1];
      const reference = children(block, "rc").find((rc) => metadataTypes[integer(rc.getAttribute("t")) - 1]?.getAttribute("name") === "XLRICHVALUE");
      if (reference) {
        const futureBlock = futureBlocks[integer(reference.getAttribute("v"))];
        const richIndex = futureBlock ? integer(descendants(futureBlock, "rvb")[0]?.getAttribute("i")) : -1;
        if (richIndex >= 0 && richImages[richIndex]) output.images.push({ ...position, ...photo(richImages[richIndex]) });
        else output.images.push({ ...position, error: "Xanadakı şəkil oxunmadı. Şəkli kompüterdən Excel-ə yenidən əlavə et." });
      }
      const formula = children(cell, "f")[0]?.textContent || "";
      // IMAGE with a literal URL can be imported without fetching it here.
      const imageUrl = formula.match(/^(?:_xlfn\.)?IMAGE\(\s*"((?:[^"]|"")+)"\s*[,;)]/i)?.[1]?.replaceAll('""', '"');
      if (imageUrl && !output.images.some((image) => image.rowNumber === position.rowNumber && image.column === position.column)) output.urls.push({ ...position, url: imageUrl });
      else if (/^(?:_xlfn\.)?IMAGE\(/i.test(formula) && !reference && !imageUrl) output.images.push({ ...position, error: "IMAGE düsturunun şəkli tapılmadı. Şəkli fayl kimi əlavə et və ya birbaşa HTTPS keçidi yaz." });
    }
    result.set(item.getAttribute("name") || "", output);
  }
  return result;
}
