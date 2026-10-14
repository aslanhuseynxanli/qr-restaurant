"use client";
import Image from "next/image";
import {useActionState,useEffect,useRef,useState} from "react";
import {createClient} from "@/lib/supabase/client";
import {uploadImportPhoto} from "@/lib/import-menu-photo";
import {parseMenuPrice,type MenuActionState,type MenuCategory,type MenuProduct} from "@/lib/menu-management";
import {saveCategoryAction,saveProductAction} from "./actions";
const input="mt-2 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-base outline-none focus:border-emerald-600 disabled:opacity-50";
const button="min-h-12 w-full rounded-xl bg-emerald-800 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";
type Feedback={onSaved?:(message:string)=>void;onBusy?:(busy:boolean)=>void};
function useFeedback(state:MenuActionState,pending:boolean,{onSaved,onBusy}:Feedback){
  useEffect(()=>{onBusy?.(pending);return()=>onBusy?.(false);},[pending,onBusy]);
  useEffect(()=>{if(state.success)onSaved?.(state.success);},[state.success,onSaved]);
}
export function CategoryForm({restaurantId,category,onSaved,onBusy}:{restaurantId:string;category?:MenuCategory}&Feedback){
  const [state,action,pending]=useActionState(saveCategoryAction,{error:""});
  const [name,setName]=useState(category?.name||""),[description,setDescription]=useState(category?.description||"");
  useFeedback(state,pending,{onSaved,onBusy});
  return <form action={action} className="space-y-4"><input type="hidden" name="restaurant_id" value={restaurantId}/><input type="hidden" name="category_id" value={category?.id||""}/>
    <label className="block text-sm font-medium">Kateqoriya adı<input className={input} name="name" required maxLength={150} value={name} onChange={e=>setName(e.target.value)} disabled={pending} placeholder="Məsələn: İçkilər"/></label>
    <label className="block text-sm font-medium">Qısa təsvir <span className="font-normal text-slate-400">(istəyə görə)</span><textarea className={input} name="description" maxLength={2000} rows={2} value={description} onChange={e=>setDescription(e.target.value)} disabled={pending}/></label>
    <details className="rounded-xl bg-slate-50 p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium text-slate-600">Sıra və görünmə</summary><div className="space-y-4 pt-3"><label className="block text-sm">Menyudakı sıra<input className={input} name="sort_order" type="number" min={0} max={2147483647} step={1} required defaultValue={category?.sort_order??0} disabled={pending}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={category?.is_active??true} disabled={pending} className="h-4 w-4 accent-emerald-700"/>Kateqoriya menyuda görünsün</label><p className="text-xs leading-5 text-slate-500">Kateqoriyanı gizlətdikdə onun məhsulları da müştəri menyusunda görünmür.</p></div></details>
    {state.error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}{state.success&&!onSaved&&<p role="status" className="text-sm text-emerald-700">{state.success}</p>}
    <button disabled={pending} className={button}>{pending?"Yadda saxlanılır…":category?"Dəyişiklikləri yadda saxla":"Kateqoriya əlavə et"}</button>
  </form>;
}
function PhotoPreview({url}:{url:string|null}){
  return url?<Image unoptimized src={url} width={160} height={120} alt="Məhsul şəklinin önizləməsi" className="h-28 w-40 rounded-xl object-cover"/>:null;
}
export function ProductForm({restaurantId,categories,product,onSaved,onBusy}:{restaurantId:string;categories:MenuCategory[];product?:MenuProduct}&Feedback){
  const uploaded=useRef<{file:File;url:string}|null>(null),[file,setFile]=useState<File|null>(null),[remove,setRemove]=useState(false),[progress,setProgress]=useState(""),[preview,setPreview]=useState<string|null>(null);
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[preview]);
  const [values,setValues]=useState({name:product?.name||"",category:product?.category_id||categories[0]?.id||"",price:product?Number(product.base_price).toFixed(2):"",description:product?.description||""});
  const [state,action,pending]=useActionState(async(previous:MenuActionState,form:FormData):Promise<MenuActionState>=>{
    if(parseMenuPrice(String(form.get("base_price")||""))===null)return {error:"Qiyməti 5 və ya 5,50 kimi yaz."};
    let image=remove?"":product?.image_url||"";
    try{
      if(file){setProgress("Şəkil hazırlanır və yüklənir…");if(uploaded.current?.file===file)image=uploaded.current.url;else{image=await uploadImportPhoto(createClient(),restaurantId,file);uploaded.current={file,url:image};}}
      form.delete("image_file");form.set("image_url",image);setProgress("Məhsul yadda saxlanılır…");
      return await saveProductAction(previous,form);
    }catch(error){return {error:error instanceof Error?error.message:"Yükləmə tamamlanmadı. Bağlantını yoxla."};}
    finally{setProgress("");}
  },{error:""});
  useFeedback(state,pending,{onSaved,onBusy});
  return <form action={action} className="space-y-4"><input type="hidden" name="restaurant_id" value={restaurantId}/><input type="hidden" name="product_id" value={product?.id||""}/>
    <label className="block text-sm font-medium">Məhsul adı<input className={input} name="name" required maxLength={150} value={values.name} onChange={e=>setValues({...values,name:e.target.value})} placeholder="Məsələn: Limonad" disabled={pending}/></label>
    <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Kateqoriya<select aria-label="Kateqoriya" className={input} name="category_id" required value={values.category} onChange={e=>setValues({...values,category:e.target.value})} disabled={pending}>{categories.map(c=><option key={c.id} value={c.id}>{c.name}{c.is_active?"":" (deaktiv)"}</option>)}</select></label><label className="block text-sm font-medium">Qiymət (AZN)<input className={input} name="base_price" inputMode="decimal" required maxLength={11} value={values.price} onChange={e=>setValues({...values,price:e.target.value})} placeholder="5,50" disabled={pending}/></label></div>
    <label className="block text-sm font-medium">Qısa təsvir <span className="font-normal text-slate-400">(istəyə görə)</span><textarea className={input} name="description" maxLength={2000} rows={2} value={values.description} onChange={e=>setValues({...values,description:e.target.value})} placeholder="Tərkibi və qısa təsviri" disabled={pending}/></label>
    <section className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><PhotoPreview url={preview||(remove?null:product?.image_url||null)}/><label className="block text-sm font-medium">Məhsul şəkli<input aria-label="Məhsul şəkli" name="image_file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp" disabled={pending} onChange={e=>{const selected=e.target.files?.[0]||null;e.target.value="";setFile(selected);setPreview(selected?URL.createObjectURL(selected):null);setRemove(false);}} className="mt-3 block w-full text-sm file:mr-3 file:min-h-11 file:rounded-xl file:border-0 file:bg-white file:px-4 file:font-semibold file:text-emerald-800"/></label><p className="text-xs leading-5 text-slate-500">İstəyə görə. Ən çox 15 MB. Böyük şəkillər yüklənməzdən əvvəl kiçildilir.</p>{(file||product?.image_url)&&<button type="button" disabled={pending} onClick={()=>{setFile(null);setPreview(null);setRemove(true);}} className="min-h-11 text-sm font-semibold text-red-700">Şəkli çıxar</button>}</section>
    <details className="rounded-xl bg-slate-50 p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium text-slate-600">Sıra və görünmə</summary><div className="space-y-4 pt-3"><label className="block text-sm">Menyudakı sıra<input className={input} name="sort_order" type="number" min={0} max={2147483647} step={1} required defaultValue={product?.sort_order??0} disabled={pending}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={product?.is_active??true} disabled={pending} className="h-4 w-4 accent-emerald-700"/>Məhsul menyuda görünsün</label></div></details>
    {state.error&&<p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{state.error}</p>}{progress&&<p role="status" className="text-sm text-emerald-800">{progress}</p>}
    <button disabled={pending||!categories.length} className={button}>{pending?"Yadda saxlanılır…":product?"Dəyişiklikləri yadda saxla":"Məhsul əlavə et"}</button>
  </form>;
}
