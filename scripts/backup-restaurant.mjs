import { verifyBackup } from './verify-backup.mjs';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function projectUrl(value) {
  const url = new URL(value), ref = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/)?.[1];
  if (!ref || url.protocol !== 'https:' || url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Standart https://PROJECT_REF.supabase.co ünvanı lazımdır.');
  return { url, ref };
}

// Bütün səhifələr və alt qovluqlar oxunur. Siyahı xətası boş bucket sayılmır.
export async function backupImages(client, directory) {
  await mkdir(path.join(directory, 'images'), { recursive: true, mode: 0o700 });
  const objects = [], visited = new Set(), bucket = client.storage.from('menu-images');
  async function walk(prefix = '', depth = 0) {
    if (depth > 30 || visited.has(prefix)) throw Error('Şəkil qovluqları oxunmadı.');
    visited.add(prefix);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bucket.list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error || !Array.isArray(data)) throw Error('Şəkil siyahısı oxunmadı.');
      for (const item of data) {
        if (typeof item.name !== 'string' || !item.name || item.name.includes('/') || ['.', '..'].includes(item.name)) throw Error('Şəkil adı düzgün deyil.');
        const key = prefix ? prefix + '/' + item.name : item.name;
        if (item.id == null && item.metadata == null) { await walk(key, depth + 1); continue; }
        const downloaded = await bucket.download(key);
        if (downloaded.error || !downloaded.data) throw Error('Şəkil yüklənmədi.');
        const bytes = Buffer.from(await downloaded.data.arrayBuffer()), file = 'images/' + sha(Buffer.from(key)) + '.bin';
        await writeFile(path.join(directory, file), bytes, { mode: 0o600 });
        objects.push({ key, file, size: bytes.length, sha256: sha(bytes), content_type: downloaded.data.type || item.metadata?.mimetype || 'application/octet-stream' });
      }
      if (data.length < 1000) break;
    }
  }
  await walk();
  return objects;
}

async function main() {
  if (typeof process.loadEnvFile !== 'function') throw Error('Node.js 20.12 və ya daha yeni versiya lazımdır.');
  try { process.loadEnvFile('.env.local'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { url, ref } = projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw Error('Layihənin server açarı .env.local daxilində yoxdur.');
  if ((await readFile('supabase/.temp/project-ref', 'utf8')).trim() !== ref) throw Error('CLI başqa layihəyə bağlıdır. EHTIYAT_NUSXE_028.md qaydasına görə doğru layihəni link et.');
  execFileSync('supabase', ['--version'], { stdio: 'ignore' });
  const directory = path.join(os.homedir(), 'qr-restaurant-backups', 'database', ref + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const manifest = { format: 1, status: 'INCOMPLETE', source_url: url.origin, created_at: new Date().toISOString(), files: [], images: [] };
  const save = () => writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  await save();
  console.log('Ehtiyat nüsxə hazırlanır. Qovluq: ' + directory);
  for (const [file, flags] of [
    ['roles.sql', ['--role-only']],
    ['schema.sql', ['--schema', 'public,private']],
    ['data.sql', ['--data-only', '--use-copy', '--schema', 'public,private,auth,storage', '-x', 'auth.schema_migrations', '-x', 'storage.migrations', '-x', 'storage.buckets_vectors', '-x', 'storage.vector_indexes']],
  ]) {
    execFileSync('supabase', ['db', 'dump', '--linked', '--file', path.join(directory, file), ...flags], { stdio: 'ignore' });
    await chmod(path.join(directory, file), 0o600);
  }
  await copyFile(new URL('../supabase/operations/restore-managed.sql', import.meta.url), path.join(directory, 'managed-schema.sql'));
  await chmod(path.join(directory, 'managed-schema.sql'), 0o600);
  for (const name of ['roles.sql', 'schema.sql', 'data.sql', 'managed-schema.sql']) {
    const bytes = await readFile(path.join(directory, name));
    if (!bytes.length) throw Error('SQL surəti boşdur.');
    manifest.files.push({ name, size: bytes.length, sha256: sha(bytes) });
  }
  const client = createClient(url.origin, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) } });
  manifest.images = await backupImages(client, directory);
  manifest.status = 'COMPLETE'; manifest.completed_at = new Date().toISOString(); await save();
  const checked=await verifyBackup(directory);
  const report=await client.rpc('platform_backup_record',{p_success:true,p_files:checked.files,p_images:checked.images,p_total_bytes:checked.bytes,p_manifest_hash:sha(Buffer.from(await readFile(path.join(directory,'manifest.json'))))});
  if(report.error)console.warn('Nüsxə hazırdır, amma admin panelinə nəticə yazılmadı. 028 SQL-i yoxla.');
  console.log('Tamamlandı: SQL və ' + manifest.images.length + ' menyu şəkli. Manifest: COMPLETE.');
  console.log('Qovluğu təhlükəsiz ikinci yerdə saxla. Bərpa sınağı EHTIYAT_NUSXE_028.md daxilindədir.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(async() => { try{const {url}=projectUrl(process.env.NEXT_PUBLIC_SUPABASE_URL||'');const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;if(key)await createClient(url.origin,key,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(10000)})}}).rpc('platform_backup_record',{p_success:false,p_files:0,p_images:0,p_total_bytes:0,p_manifest_hash:'0'.repeat(64)});}catch{}console.error('Ehtiyat nüsxə tamamlanmadı. INCOMPLETE surət bərpa üçün yararlı sayılmır. CLI bağlantısı, Docker və .env.local ayarlarını EHTIYAT_NUSXE_028.md üzrə yoxla.'); process.exitCode = 1; });
