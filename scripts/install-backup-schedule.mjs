import {mkdir,writeFile,unlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
const label='az.qr-restaurant.backup';
const xml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function buildBackupPlist({node,project,logs,envPath}){return `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${xml(node)}</string><string>${xml(path.join(project,'scripts/backup-restaurant.mjs'))}</string></array><key>WorkingDirectory</key><string>${xml(project)}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>${xml(envPath)}</string></dict><key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>0</integer></dict><key>StandardOutPath</key><string>${xml(path.join(logs,'backup.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(logs,'backup-error.log'))}</string><key>ProcessType</key><string>Background</string></dict></plist>\n`;}
async function main(){const project=path.resolve(fileURLToPath(new URL('..',import.meta.url))),logs=path.join(os.homedir(),'qr-restaurant-backups','logs'),agent=path.join(os.homedir(),'Library','LaunchAgents',label+'.plist'),domain='gui/'+process.getuid();
 const plist=buildBackupPlist({node:process.execPath,project,logs,envPath:process.env.PATH||'/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin'});
 if(process.argv.includes('--print')){console.log(plist);return;}if(process.platform!=='darwin')throw Error('Bu quraşdırıcı macOS üçündür.');
 if(process.argv.includes('--remove')){try{execFileSync('/bin/launchctl',['bootout',domain,agent],{stdio:'ignore'});}catch{}await unlink(agent).catch(e=>{if(e.code!=='ENOENT')throw e;});console.log('Bu layihənin gündəlik nüsxə planı söndürüldü. Mövcud nüsxələr saxlanılıb.');return;}
 execFileSync('supabase',['--version'],{stdio:'ignore'});execFileSync('docker',['info'],{stdio:'ignore'});
 await mkdir(logs,{recursive:true,mode:0o700});await mkdir(path.dirname(agent),{recursive:true});await writeFile(agent,plist,{mode:0o600});try{execFileSync('/bin/launchctl',['bootout',domain,agent],{stdio:'ignore'});}catch{}execFileSync('/bin/launchctl',['bootstrap',domain,agent],{stdio:'ignore'});console.log('Gündəlik ehtiyat nüsxə yerli saatla 04:00 üçün quruldu. Kompüter, internet və Docker işlək olmalıdır. Nəticəni admin panelindən yoxla.');}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{console.error('Plan qurulmadı. macOS, Supabase CLI, Docker və layihə yolunu EHTIYAT_NUSXE_028.md üzrə yoxla.');process.exitCode=1;});
