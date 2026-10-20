import {existsSync} from 'node:fs';
import {verifyBackup} from './verify-backup.mjs';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectUrl } from './backup-restaurant.mjs';

export async function prepareTestRestore(directory, target, databaseAddress) {
  await verifyBackup(directory);
  const manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  const { url, ref } = projectUrl(target), { url: source } = projectUrl(manifest.source_url);
  if (manifest.format !== 1 || manifest.status !== 'COMPLETE' || url.hostname === source.hostname) throw Error('Yalnız başqa, yeni boş test layihəsinə bərpa etmək olar.');
  const db = new URL(databaseAddress), user = decodeURIComponent(db.username), port = db.port || '5432';
  const direct = db.hostname === 'db.' + ref + '.supabase.co' && user === 'postgres';
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(db.hostname) && user === 'postgres.' + ref;
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.password || db.pathname !== '/postgres' || port !== '5432' || (!direct && !pooler) || db.hash || [...db.searchParams.keys()].some(k => k !== 'sslmode')) throw Error('Test bazasının Direct və ya Session pooler bağlantısını (5432) daxil et.');
  const files = [];
  for (const name of ['roles.sql', 'schema.sql', 'data.sql', 'managed-schema.sql']) {
    const info = manifest.files?.find(f => f.name === name), file = path.join(directory, name), bytes = await readFile(file);
    if (!info || !bytes.length || bytes.length !== info.size || createHash('sha256').update(bytes).digest('hex') !== info.sha256) throw Error('SQL surəti dəyişib və ya tamamlanmayıb.');
    files.push(file);
  }
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  const oldPrefix = source.origin + '/storage/v1/object/public/menu-images/', newPrefix = url.origin + '/storage/v1/object/public/menu-images/';
  const rewriteSQL = [['products', 'image_url'], ['categories', 'image_url'], ['restaurants', 'logo_url'], ['profiles', 'avatar_url']].map(([table, column]) => `update public.${table} set ${column}=${quote(newPrefix)} || substr(${column},char_length(${quote(oldPrefix)})+1) where left(${column},char_length(${quote(oldPrefix)}))=${quote(oldPrefix)};`).join('\n');
  return { files, rewriteSQL, connection: { PGHOST: db.hostname, PGPORT: port, PGUSER: user, PGDATABASE: 'postgres', PGPASSWORD: decodeURIComponent(db.password), PGSSLMODE: 'require' } };
}

async function main() {
  const [directory, flag, target] = process.argv.slice(2);
  if (!directory || flag !== '--test-project' || !target || process.argv.length !== 5 || !process.env.BACKUP_RESTORE_DB_URL) throw Error('EHTIYAT_NUSXE_028.md daxilindəki əmrdən istifadə et.');
  const ready = await prepareTestRestore(path.resolve(directory), target, process.env.BACKUP_RESTORE_DB_URL);
  // Şifrələr proses arqumentlərinə və loglara daxil edilmir.
  const emptyTest = "do $$ begin if exists(select 1 from pg_tables where schemaname in ('public','private')) or exists(select 1 from auth.users) then raise exception 'TEST_DATABASE_NOT_EMPTY';end if;end $$;";
  const psql=['/opt/homebrew/opt/libpq/bin/psql','/usr/local/opt/libpq/bin/psql'].find(existsSync)||'psql';
  execFileSync(psql, ['--no-psqlrc', '--single-transaction', '--variable', 'ON_ERROR_STOP=1', '--command', emptyTest, '--file', ready.files[0], '--file', ready.files[1], '--command', 'SET session_replication_role = replica', '--file', ready.files[2], '--command', ready.rewriteSQL, '--command', 'SET session_replication_role = origin', '--file', ready.files[3]], { env: { ...process.env, ...ready.connection }, stdio: 'ignore' });
  console.log('SQL test bazasına bərpa edildi. İndi restore-menu-images.mjs və EHTIYAT_NUSXE_028.md üzrə yoxlamaları et.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => { console.error('Bərpa dayandırıldı. Mənbədən fərqli boş test layihəsi, 5432 bağlantısı, psql və COMPLETE surət tələb olunur. Xəta zamanı SQL tranzaksiyası geri qaytarılır. EHTIYAT_NUSXE_028.md-ni yoxla.'); process.exitCode = 1; });
