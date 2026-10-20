import { createClient } from '@supabase/supabase-js';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectUrl } from './backup-restaurant.mjs';

export async function restoreImages(client, directory) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.format !== 1 || manifest.status !== 'COMPLETE' || !Array.isArray(manifest.images)) throw Error('Tamamlanmış surət lazımdır.');
  const root = await realpath(directory), keys = new Set(), files = [];
  // Son fayl pozulubsa belə, ilk fayl da yüklənmir.
  for (const image of manifest.images) {
    if (typeof image.key !== 'string' || !image.key || image.key.split('/').some(p => !p || p === '.' || p === '..') || keys.has(image.key) || !/^images\/[a-f0-9]{64}\.bin$/.test(image.file) || !/^[a-f0-9]{64}$/.test(image.sha256) || !Number.isSafeInteger(image.size) || image.size < 0 || typeof image.content_type !== 'string') throw Error('Şəkil surəti düzgün deyil.');
    keys.add(image.key);
    const file = await realpath(path.join(root, image.file));
    if (!file.startsWith(root + path.sep)) throw Error('Şəkil surəti qovluqdan kənardadır.');
    const bytes = await readFile(file);
    if (bytes.length !== image.size || createHash('sha256').update(bytes).digest('hex') !== image.sha256) throw Error('Şəkil surəti dəyişib.');
    files.push({ image, file });
  }
  for (const { image, file } of files) {
    const { error } = await client.storage.from('menu-images').upload(image.key, await readFile(file), { contentType: image.content_type, upsert: true });
    if (error) throw Error('Test şəkli yüklənmədi.');
  }
  return files.length;
}

export async function validateImageDestination(directory, target) {
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const { url } = projectUrl(target), { url: source } = projectUrl(manifest.source_url);
  if (manifest.format !== 1 || manifest.status !== 'COMPLETE' || url.hostname === source.hostname) throw Error('Canlı mənbə layihəsinə bərpa edilmir.');
  return url.origin;
}
async function main() {
  const [directory, flag, target] = process.argv.slice(2), key = process.env.BACKUP_RESTORE_SECRET_KEY;
  if (!directory || flag !== '--test-project' || !target || process.argv.length !== 5 || !key) throw Error('EHTIYAT_NUSXE_028.md qaydasına görə test server açarını daxil et.');
  const origin = await validateImageDestination(directory, target);
  const client = createClient(origin, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30000) }) } });
  console.log('Test layihəsinə ' + await restoreImages(client, directory) + ' şəkil bərpa edildi. EHTIYAT_NUSXE_028.md üzrə login, sifariş və şəkilləri yoxla.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Şəkillərin bərpası tamamlanmadı. COMPLETE surət və mənbədən fərqli test layihəsi/açarı tələb olunur. Qayda EHTIYAT_NUSXE_028.md daxilindədir.'); process.exitCode = 1; });
