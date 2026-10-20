# SQL, şəkillər və gündəlik ehtiyat nüsxə

Bu qayda macOS üçündür. Yeniləmə fayllarının quraşdırılması planlaşdırılmış nüsxəni öz-özünə aktivləşdirmir; aşağıdakı bir dəfəlik quruluşu Mac-də tamamla.

## İlk nüsxə

028 SQL tətbiq olunmalıdır. Node.js 20.12 və ya daha yeni versiya, Supabase CLI və işləyən Docker lazımdır. `.env.local` daxilində tətbiqin mövcud `NEXT_PUBLIC_SUPABASE_URL` və server açarı (`SUPABASE_SECRET_KEY` və ya əvvəlki `SUPABASE_SERVICE_ROLE_KEY`) istifadə edilir. Yeni email və ya tətbiq açarı tələb olunmur.

Supabase CLI yoxdursa, Homebrew olan Mac-də:

```bash
brew install supabase/tap/supabase
```

Docker tətbiqini aç. VS Code terminalında əsas `qr-restaurant` qovluğunda:

```bash
supabase login
supabase link
```

`link` zamanı `.env.local`-dakı URL-ə uyğun mövcud layihəni seç. `supabase/config.toml` yoxdursa əvvəl `supabase init` işlət; mövcud miqrasiya fayllarını saxla. Skript linklənmiş layihəni `.env.local` ilə tutuşdurur; uyğun gəlməyən layihədən nüsxə götürmür.

```bash
node scripts/backup-restaurant.mjs
```

SQL sxemi və məlumatları, istifadəçilər/giriş məlumatları, Storage metadatası və `menu-images` faylları surətə daxil edilir. Nüsxə `~/qr-restaurant-backups/database/` altında tarixli qovluğa yazılır. Yalnız `manifest.json` içində `COMPLETE` olan surət tamamlanmış sayılır. Xəta olarsa `INCOMPLETE` qalır; skript uğursuz çıxış kodu verir.

Çıxışda göstərilən nüsxə qovluğunun yolunu yazaraq yoxla:

```bash
node scripts/verify-backup.mjs "NUSXE_QOVLUGUNUN_TAM_YOLU"
```

Bu əmr bütün SQL/şəkil fayllarının ölçüsünü və hash-ini yoxlayır. Nüsxə şəxsi məlumatları da ehtiva edir; onu paylaşma və GitHub-a yükləmə. Etibarlı ikinci yerdə əlavə surət saxla. Diskdə yerin qalmasını izləmək lazımdır; skript əvvəlki nüsxələri avtomatik silmir.

## Gündəlik plan

İlk nüsxə uğurla alındıqdan sonra əsas layihə qovluğunda:

```bash
node scripts/install-backup-schedule.mjs
```

Bu komanda həmin Mac istifadəçisi üçün hər gün yerli saatla **04:00** nüsxə işi qurur. Kompüter, internet və Docker işlək olmalıdır. Vercel saytının açıq qalması bu Mac-dəki işi işə salmır. Layihənin və Node proqramının yolunu dəyişsən planı yenidən quraşdır.

Platforma admini → **Sistem yoxlaması və ehtiyat nüsxə → Vəziyyəti yoxla**.

Tamamlanmış və uğursuz işin son nəticəsi burada göstərilir. Son nüsxə 48 saatdan köhnədirsə xəbərdarlıq rəngində görünür. CLI bağlantısı alınmadıqda qeydin özü də yazılmaya bilər; tarixə və `~/qr-restaurant-backups/logs/` içindəki nəticəyə bax. “Nüsxə hazırdır, amma admin panelinə nəticə yazılmadı” mesajı fayl nüsxəsinin hazır, uzaq qeydin isə yazılmamış olduğunu bildirir.

Planı söndürmək üçün:

```bash
node scripts/install-backup-schedule.mjs --remove
```

Mövcud nüsxələr saxlanır.

## Ayrı test layihəsinə bərpa

Bərpa yalnız **mənbədən fərqli, yeni və boş Supabase test layihəsinə** qəbul edilir. Skript ünvanın başqa layihəyə aid olduğunu, SQL/şəkil fayllarını və bazanın boşluğunu yoxlayır. Sxem/məlumat bərpası bir SQL tranzaksiyasında aparılır. Canlı layihəyə bərpa bu alətdə bağlıdır.

`psql` yoxdursa Mac-də `brew install libpq` işlət. Skript Homebrew-un Apple Silicon və Intel yollarını da tanıyır.

Layihə qovluğunda `.env.restore` yarat və yalnız **test layihəsinin** dəyərlərini yaz:

```dotenv
BACKUP_RESTORE_DB_URL=postgresql://TEST_DATABASE_CONNECTION
BACKUP_RESTORE_SECRET_KEY=TEST_PROJECT_SERVER_KEY
```

DB bağlantısını test layihəsinin Connect bölməsindən Direct və ya Session pooler, **5432** portu ilə götür. URL-də xüsusi simvollu şifrə düzgün URL formatında olmalıdır. Mənbə URL-i və ya mənbə server açarını burada yazma.

Aşağıdakı əmrlərdə qovluq yolunu və `TEST_REF` ünvanını öz test dəyərlərinlə əvəz et:

```bash
node --env-file=.env.restore scripts/restore-test-database.mjs "NUSXE_QOVLUGUNUN_TAM_YOLU" --test-project https://TEST_REF.supabase.co
node --env-file=.env.restore scripts/restore-menu-images.mjs "NUSXE_QOVLUGUNUN_TAM_YOLU" --test-project https://TEST_REF.supabase.co
```

Daha sonra ayrıca yerli tətbiq surətini test layihəsinə bağlayıb sahib girişini, menyu şəkillərini, hesab tarixçəsini və 028 düzəlişlərini yoxla. Test surətindən yeni sifariş/ödəniş axınını tamamla. Testdəki email, redirect və Auth ayarları ayrıca test layihəsinə uyğun qurulur. `.env.restore` və ehtiyat nüsxələri commit etmə.

Bu paketdə fayl hash-i, plan XML-i, qoruyucu bərpa qaydaları və lokal SQL axınları yoxlanıb. Sənin canlı layihəndən real nüsxə alınması və ayrıca Supabase layihəsinə bərpa burada icra edilməyib.

Rəsmi mənbələr:
- https://supabase.com/docs/guides/local-development/cli/getting-started
- https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore
