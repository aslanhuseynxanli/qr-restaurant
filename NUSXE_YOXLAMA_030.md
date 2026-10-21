# Ehtiyat nüsxə nədir və necə yoxlanır?

Sadə nümunə: bazada problem yaransa, restoranlar, menyu, sifarişlər, ödənişlər və şəkillər əvvəldən saxlanmış surətdən geri gətirilir. Kodun GitHub-da olması bu məlumatların ehtiyat nüsxəsi demək deyil.

Hazırkı layihədə SQL və menyu şəkillərini birlikdə köçürən alət artıq var. 030 onu yenidən qurmur və işləyən sifariş axınını dəyişmir.

## Əvvəl mövcud vəziyyətə bax

Platforma admini → **Sistem yoxlaması və ehtiyat nüsxə** → **Vəziyyəti yoxla**.

Son nəticənin tarixinə bax. “Tamamlanıb” görünməsi nüsxə alətinin faylları hazırlayıb yoxladığını bildirir. Köhnə tarix və ya qeydin olmaması canlı vəziyyətin ayrıca yoxlanmasını tələb edir. “Yeniləmə: 028” həmin mövcud nüsxə alətinin versiyasıdır; 030-da ödəniş düzəlişi ayrıca əlavə edilir.

## İlk nüsxəni al

Əgər nüsxə alətini hələ qurmamısansa, layihədəki **EHTIYAT_NUSXE_028.md** sənədinin “İlk nüsxə” hissəsini tamamla: Supabase CLI, Docker və mövcud layihəyə düzgün bağlantı tələb olunur.

VS Code-da əsas layihənin terminalında:

```bash
node scripts/backup-restaurant.mjs
```

Komanda SQL fayllarını və menyu şəkillərini `~/qr-restaurant-backups/database/` altında tarixli qovluğa köçürür və faylların ölçü/hash yoxlamasını aparır. Yalnız **Tamamlandı** nəticəsi və manifestdə **COMPLETE** olan surət hazır sayılır. Nüsxə yolunu qeyd et. Sonra admin panelində vəziyyəti yenidən yoxla.

Gündəlik planı hələ aktivləşdirməmisənsə, uğurlu ilk nüsxədən sonra:

```bash
node scripts/install-backup-schedule.mjs
```

Hazırkı plan Mac-də işləyir. Mac, internet və Docker işlək olmalıdır; Vercel deploy-u bu planı avtomatik aktivləşdirmir. Nüsxənin əlavə surətini etibarlı ikinci yerdə saxla. Nüsxə fayllarını və açarları GitHub-a yükləmə.

## “Real bərpa sınağı” nə deməkdir?

Bir dəfə ayrıca **yeni və boş Supabase test layihəsi** açılır. Canlı layihədən alınmış hazır surət həmin test layihəsinə qaytarılır. Test tətbiqində sahib girişi, menyu şəkilləri, sifarişlər, hesab tarixçəsi və ödəniş bölgüsü açılıb yoxlanır.

Bu iş üçün `EHTIYAT_NUSXE_028.md` sənədinin **Ayrı test layihəsinə bərpa** hissəsindəki mövcud qaydanı istifadə et. Alət test ünvanını və boş bazanı yoxlayır; mənbə layihəyə bərpanı qəbul etmir.

Bu ZIP-in hazırlanmasında lokal nüsxə yoxlayıcısı və qoruyucu qaydalar sınaqdan keçirilib. Sənin Mac-də planın qurulduğu, canlı bazadan surət alındığı və başqa Supabase layihəsinə uğurla bərpa edildiyi burada təsdiqlənməyib. Bunlar yalnız yuxarıdakı real nəticələr alındıqdan sonra tamamlanmış sayılır.
