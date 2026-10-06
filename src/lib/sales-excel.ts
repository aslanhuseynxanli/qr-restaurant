import {zipSync,strToU8} from "fflate";
import {formatOwnerTime} from "./owner-dashboard";
import {filledSalesDays,sortSalesProducts,type SalesReport} from "./sales-report";

type Cell=string|{value:string;money?:boolean};
type Sheet={name:string;headers:string[];rows:Cell[][];widths:number[]};
const xmlHeader='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const spreadsheet='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relationships='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const xml=(value:string)=>value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g,"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");
const numeric=(value:string,money=false):Cell=>({value,money});
function column(index:number):string{let result="";for(let n=index+1;n>0;n=Math.floor((n-1)/26))result=String.fromCharCode(65+(n-1)%26)+result;return result;}
function cellXML(value:Cell,address:string,header=false):string{
  if(typeof value!=="string"&&/^\d+(?:\.\d{1,2})?$/.test(value.value)){
    // Excel keeps at most 15 significant decimal digits. Preserve larger values as text.
    const digits=value.value.replace(".","").replace(/^0+/,"").length;
    if(digits<=15)return `<c r="${address}" s="${value.money?2:3}" t="n"><v>${value.value}</v></c>`;
  }
  const text=typeof value==="string"?value:value.value;
  return `<c r="${address}" s="${header?1:0}" t="inlineStr"><is><t xml:space="preserve">${xml(text)}</t></is></c>`;
}
function sheetXML(sheet:Sheet):string{
  if(sheet.rows.length>1048575)throw new Error("REPORT_TOO_LARGE");
  const last=`${column(sheet.headers.length-1)}${sheet.rows.length+1}`;
  return xmlHeader+`<worksheet xmlns="${spreadsheet}"><dimension ref="A1:${last}"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>${sheet.widths.map((width,i)=>`<col min="${i+1}" max="${i+1}" width="${width}" customWidth="1"/>`).join("")}</cols><sheetData><row r="1" ht="30" customHeight="1">${sheet.headers.map((text,i)=>cellXML(text,column(i)+"1",true)).join("")}</row>${sheet.rows.map((row,index)=>`<row r="${index+2}">${row.map((value,i)=>cellXML(value,`${column(i)}${index+2}`)).join("")}</row>`).join("")}</sheetData><autoFilter ref="A1:${last}"/><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}
export function salesWorkbook(report:SalesReport):Uint8Array {
  const branch=report.filters.branch_id?report.branches.find(b=>b.id===report.filters.branch_id)?.name||"Seçilmiş filial":"Bütün filiallar";
  const products=sortSalesProducts(report.products,false,"quantity"),legacyProducts=sortSalesProducts(report.products,true,"quantity");
  const sheets:Sheet[]=[
    {name:"Məlumat",headers:["Məlumat","Dəyər"],widths:[30,100],rows:[
      ["Restoran",report.restaurant_name],["Filial",branch],["Başlanğıc tarix",report.filters.from],["Son tarix",report.filters.to],
      ["Saat qurşağı","Bakı · Asia/Baku"],["Hazırlandı",formatOwnerTime(report.generated_at)],
      ["Qeyd edilmiş satış","Faktiki ödənişi qeyd edilmiş, bağlanmış masa hesabları. Ləğv edilmiş sifarişlər daxil deyil."],
      ["Əvvəlki hesablar","Ödəniş bölgüsü qeydsiz bağlanmış hesablar ayrıca vərəqdədir; kart/nağd yekununa daxil deyil."],
      ["Tarix hesablaması","Hesabın bağlandığı tarixə görə, Bakı vaxtı ilə. Sifarişin verildiyi tarix fərqli ola bilər."],
      ["Sifarişsiz bağlanan masalar",numeric(report.empty_count)],["Böyük rəqəmlər","Excel-in 15 rəqəm dəqiqliyini aşan məbləğ və saylar dəyişmədən mətn kimi saxlanılır."]]},
    {name:"Yekun",headers:["Valyuta","Qeyd edilmiş hesab sayı","Qeyd edilmiş satış","Nağd","Kart","Orta hesab","Məhsul sayı"],widths:[12,26,24,20,20,20,18],
      rows:report.totals.map(t=>[t.currency,numeric(t.count),numeric(t.total,true),numeric(t.cash,true),numeric(t.card,true),numeric(t.average,true),numeric(t.quantity)])},
    {name:"Günlər",headers:["Tarix","Valyuta","Qeyd edilmiş hesab sayı","Qeyd edilmiş satış","Nağd","Kart","Əvvəlki hesab sayı","Əvvəlki məbləğ"],widths:[16,12,26,24,20,20,22,24],
      rows:report.totals.flatMap(t=>filledSalesDays(report,t.currency)).map(t=>[t.day,t.currency,numeric(t.count),numeric(t.total,true),numeric(t.cash,true),numeric(t.card,true),numeric(t.legacy_count),numeric(t.legacy_total,true)])},
    {name:"Filiallar",headers:["Filial","Status","Valyuta","Qeyd edilmiş hesab sayı","Qeyd edilmiş satış","Nağd","Kart","Orta hesab","Məhsul sayı","Əvvəlki hesab sayı","Əvvəlki məbləğ"],widths:[32,16,12,26,24,20,20,20,18,22,24],
      rows:report.by_branch.map(t=>[t.name,t.is_active?"Aktiv":"Deaktiv",t.currency||"",numeric(t.count),numeric(t.total,true),numeric(t.cash,true),numeric(t.card,true),numeric(t.average,true),numeric(t.quantity),numeric(t.legacy_count),numeric(t.legacy_total,true)])},
    {name:"Məhsullar",headers:["Məhsul","Valyuta","Satış sayı","Satış məbləği","Hesab sayı"],widths:[45,12,18,24,18],
      rows:products.map(p=>[p.name,p.currency,numeric(p.quantity),numeric(p.total,true),numeric(p.account_count)])},
    {name:"Əvvəlki hesablar",headers:["Valyuta","Hesab sayı","Məbləğ","Məhsul sayı","Ödəniş bölgüsü"],widths:[12,18,24,18,45],
      rows:report.totals.filter(t=>t.legacy_count!=="0").map(t=>[t.currency,numeric(t.legacy_count),numeric(t.legacy_total,true),numeric(t.legacy_quantity),"Qeyd edilməyib"])},
    {name:"Əvvəlki məhsullar",headers:["Məhsul","Valyuta","Satış sayı","Məbləğ","Hesab sayı","Ödəniş bölgüsü"],widths:[45,12,18,24,18,35],
      rows:legacyProducts.map(p=>[p.name,p.currency,numeric(p.legacy_quantity),numeric(p.legacy_total,true),numeric(p.legacy_account_count),"Qeyd edilməyib"])},
  ];
  const files:Record<string,Uint8Array>={};const put=(name:string,text:string)=>{files[name]=strToU8(text);};
  put("[Content_Types].xml",xmlHeader+`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`);
  put("_rels/.rels",xmlHeader+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  put("xl/workbook.xml",xmlHeader+`<workbook xmlns="${spreadsheet}" xmlns:r="${relationships}"><bookViews><workbookView/></bookViews><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets><calcPr calcId="191029"/></workbook>`);
  put("xl/_rels/workbook.xml.rels",xmlHeader+`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="${relationships}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="${relationships}/styles" Target="styles.xml"/></Relationships>`);
  put("xl/styles.xml",xmlHeader+`<styleSheet xmlns="${spreadsheet}"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF065F46"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`);
  sheets.forEach((s,i)=>put(`xl/worksheets/sheet${i+1}.xml`,sheetXML(s)));
  return zipSync(files,{level:6});
}
