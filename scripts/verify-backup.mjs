import {readFile,lstat,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export async function verifyBackup(directory){
 const root=await realpath(directory),manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.format!==1||manifest.status!=='COMPLETE'||!Array.isArray(manifest.files)||!Array.isArray(manifest.images)||!['roles.sql','schema.sql','data.sql','managed-schema.sql'].every(n=>manifest.files.some(f=>f.name===n)))throw Error('Tam ehtiyat nüsxə deyil.');
 let bytes=0;const seen=new Set();
 for(const file of [...manifest.files.map(f=>({...f,file:f.name})),...manifest.images]){
  if(typeof file.file!=='string'||path.isAbsolute(file.file)||file.file.split(/[\\/]/).some(p=>p==='..'||p==='.')||seen.has(file.file)||!Number.isSafeInteger(file.size)||file.size<0||typeof file.sha256!=='string'||!/^[a-f0-9]{64}$/.test(file.sha256))throw Error('Manifest düzgün deyil.');seen.add(file.file);
  const target=path.join(root,file.file),stat=await lstat(target);if(!stat.isFile()||stat.isSymbolicLink()||stat.size!==file.size||!((await realpath(target)).startsWith(root+path.sep)))throw Error('Fayl yoxlanmadı.');
  const hash=createHash('sha256').update(await readFile(target)).digest('hex');if(hash!==file.sha256)throw Error('Faylın yoxlama cəmi uyğun deyil.');bytes+=stat.size;
 }
 return {files:manifest.files.length,images:manifest.images.length,bytes};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){verifyBackup(process.argv[2]||'').then(r=>console.log(`Nüsxənin faylları düzgündür: ${r.files} SQL faylı, ${r.images} şəkil, ${r.bytes} bayt. Bərpa sınağı ayrıca icra edilməlidir.`)).catch(()=>{console.error('Ehtiyat nüsxə yoxlamadan keçmədi. COMPLETE manifesti, faylları və yolları yoxla.');process.exitCode=1;});}
