import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transpileModule,ModuleKind,ScriptTarget} from 'typescript';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {buildBackupPlist} from './install-backup-schedule.mjs';
import {prepareTestRestore} from './restore-test-database.mjs';
import {verifyBackup} from './verify-backup.mjs';
const root=new URL('../',import.meta.url),temp=await mkdtemp(path.join(os.tmpdir(),'qr-operations-tests-'));let n=0;
const pass=t=>console.log('✓ '+(++n)+' '+t);
try{
 for(const name of ['account-payments','daily-operations']){let source=await readFile(new URL('src/lib/'+name+'.ts',root),'utf8');if(name==='daily-operations')source=source.replace('"./account-payments"','"./account-payments.mjs"');const js=transpileModule(source,{compilerOptions:{target:ScriptTarget.ES2020,module:ModuleKind.ES2022}}).outputText;await writeFile(path.join(temp,name+'.mjs'),js);}
 const {amountCents,centsAmount}=await import(pathToFileURL(path.join(temp,'account-payments.mjs'))),{splitAmount,adjustedTotal}=await import(pathToFileURL(path.join(temp,'daily-operations.mjs')));
 assert.equal(amountCents('12,50'),1250n);assert.equal(amountCents('0.01'),1n);for(const x of ['-1','NaN','Infinity','1.001','1e3','','.5'])assert.equal(amountCents(x),null);pass('Məbləğlər qəpik dəqiqliyi ilə yoxlanır');
 assert.deepEqual(splitAmount('10.00',3),['3.34','3.33','3.33']);for(let i=1;i<100;i++)for(const count of [2,3,7,50]){const total=centsAmount(BigInt(i*7919)),parts=splitAmount(total,count);assert.equal(parts.reduce((sum,p)=>sum+amountCents(p),0n),amountCents(total));assert(parts.every(p=>amountCents(p)>=0n));}pass('Hesab bölünəndə qəpik itmir və artıq məbləğ yaranmır');
 assert.equal(adjustedTotal('15.75','0.75','10'),'16.50');assert.equal(adjustedTotal('0.05','0','10'),'0.06');assert.equal(adjustedTotal('100.00','100.00','12.5'),'0.00');assert.equal(adjustedTotal('10','11','0'),null);assert.equal(adjustedTotal('10','0','100.01'),null);pass('Endirim və servis düzgün ardıcıllıqla hesablanır');
 const plist=buildBackupPlist({node:'/opt/node',project:'/Users/test/QR & Bistro',logs:'/Users/test/logs',envPath:'/opt/bin:/usr/bin'});assert(plist.includes('QR &amp; Bistro'));assert(plist.includes('<integer>4</integer>'));assert(!plist.includes('SUPABASE_SECRET'));assert(!plist.includes('<key>RunAtLoad</key>'));pass('macOS nüsxə planı yolları qoruyur və açar saxlamır');
 const b=path.join(temp,'backup');await mkdir(path.join(b,'images'),{recursive:true});const files=[],images=[];for(const name of ['roles.sql','schema.sql','data.sql','managed-schema.sql','images/a.bin']){const bytes=Buffer.from('test '+name);await writeFile(path.join(b,name),bytes);const entry={size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};if(name.startsWith('images'))images.push({...entry,file:name,key:'sample'});else files.push({...entry,name});}
 await writeFile(path.join(b,'manifest.json'),JSON.stringify({format:1,status:'COMPLETE',source_url:'https://sourceproject.supabase.co',files,images}));assert.equal((await verifyBackup(b)).images,1);await prepareTestRestore(b,'https://targetproject.supabase.co','postgresql://postgres:test@db.targetproject.supabase.co:5432/postgres');await assert.rejects(prepareTestRestore(b,'https://sourceproject.supabase.co','postgresql://postgres:test@db.sourceproject.supabase.co:5432/postgres'));await assert.rejects(prepareTestRestore(b,'https://targetproject.supabase.co','postgresql://postgres:test@wrong.example:5432/postgres'));await writeFile(path.join(b,'images/a.bin'),'tampered');await assert.rejects(verifyBackup(b));pass('Ehtiyat nüsxənin bütün SQL və şəkil faylları yoxlanır; dəyişmiş fayl rədd edilir');
 console.log(`OPERATION_TESTS_COMPLETE ${n}`);
}finally{await rm(temp,{recursive:true,force:true});}
