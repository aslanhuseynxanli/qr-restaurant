# Gündəlik restoran işləri — 028

Bu yeniləmə 027 üzərinə quraşdırılır. Ümumi CSS yenilənməsi bu paketə daxil deyil.

## Məhsulun sayı və ləğvi

Ofisiant → **Masalar** → sifariş → **Məhsulları düzəlt / ləğv et**.

Sayı azalt, məhsulu çıxarmaq üçün 0 seç və səbəb yaz. Bütün sifarişi ləğv etmək üçün eyni pəncərədə **Bütün məhsulları ləğv et** var. İlkin say, dəyişiklik, səbəb və vaxt saxlanır. Hazırlanan məhsulun dəyişməsi mətbəxdə görünür və səs aktivdirsə bildiriş verilir. Tam ləğv edilən sifariş də mətbəxin son dəyişikliklər siyahısında qalır. Müştəri öz sifarişinin düzəlişini görür.

Servis edilmiş məhsulu yalnız sahib, ödəniş başlamazdan əvvəl düzəldə bilər. Məhsul əlavə etmək üçün mövcud **Masa üçün sifariş əlavə et** istifadə olunur.

## Masanı dəyişmək

Ofisiant → **Masalar** → masa → **Masanı dəyiş** → həmin filialın boş masasını seç.

Açıq hesab, sifarişlər və çağırışlar birlikdə köçürülür. Mətbəxdə yeni masa adı görünür. Müştərinin əvvəlki QR-dan açılmış etibarlı ziyarəti həmin hesabı izləməyə və sifariş verməyə davam edir. Köhnə masada yeni müştəri ayrı hesab aça bilər. Hər hansı açıq hesabı olan masaya köçürmək və filiallar arasında köçürmək qəbul edilmir.

## Hesabı açmaq və çap

Ofisiant → **Masalar** → **Hesabı aç / Çap et**. Sahib bağlanmış hesabı **Hesab tarixçəsi → Hesabın detallarına bax → Hesabı çap et** yolu ilə aça bilər.

58 mm, 80 mm və A4 seçimləri var. **Çap et / PDF saxla** brauzerin çap pəncərəsini açır. Açıq hesab “Aralıq hesab” kimi görünür. Məhsul, endirim, servis, ödənilmiş hissələr və qalıq göstərilir. Fiziki printerlə iş brauzerin və printerin ayarlarından asılıdır.

## Endirim və servis haqqı

Sahib → **Ofisiant paneli → Masalar → Endirim / Servis haqqı**.

Endirim valyuta ilə məbləğ, servis haqqı faiz kimi daxil edilir. Səbəb məcburidir. Servis endirim çıxıldıqdan sonra hesablanır və qəpiyə yuvarlaqlaşdırılır. Məsələn: 25.00 − 2.50 + 10% servis (2.25) = 24.75 AZN. Ofisiant və mətbəx bu məbləğləri dəyişə bilməz.

## Hesabı adamlar arasında bölmək

Sifarişlər servis edildikdən sonra **Hesabı hazırla**, ardınca **Hesabı böl / Hissə ödənişi al**.

Qalan məbləğin neçə hissəyə bölünəcəyini seçmək olur; qəpik fərqi dəqiq bölüşdürülür. İndi faktiki alınan hissəni və onun kart/nağd üsulunu qeyd et. “1-ci nəfər” kimi qeyd istəyə bağlıdır. Hissə məbləğini əl ilə də yazmaq olar. Son hissə alınanda masa avtomatik bağlanır. **Ödəniş alındı · Masanı bağla** isə qalan bütün məbləği bağlamaq üçündür.

İlk ödənişdən sonra məhsul, endirim, servis və masa dəyişiklikləri kilidlənir. Hesabı yenidən sifariş qəbuluna açmaq olmur. Bu, alınmış pulla hesabın məbləğinin ayrılmasının qarşısını alır.

Cavab itərsə **Eyni əməliyyatı yenidən yoxla** seç. Hissə ödənişinin sorğusu həmin brauzer sessiyasında refreshdən sonra da saxlanır. Eyni təsdiqin təkrarı ikinci ödəniş yaratmır. Dəqiq nəticə alınana qədər sorğunu fərqli məbləğlə yenidən yaratma.

Hesabatlar bağlanan hesabın faktiki yekununu göstərir; kart və nağd hissələr birləşdirilir. Tarix masanın bağlandığı günə əsaslanır. Hələ açıq olan masanın hissə ödənişi həmin masada görünür və masa bağlananda satış hesabatına daxil olur. Məhsul hesabatındakı məhsul məbləğləri endirim/servisdən əvvəlki satışdır.

## Səsin yadda saxlanması

Ofisiant və mətbəxdə seçim və səviyyə eyni brauzerdə saxlanır. Refresh və səhifə keçidi seçimi sıfırlamır. Səsi söndürəndə bu seçim də saxlanır.

Brauzer icazə verəndə səs özü bərpa edilir. Səs avtomatik oynatmaya görə bloklanıbsa seçim açıq qalır və “Səsin başlaması üçün ekrana toxun” görünür; adi toxunuş və ya klaviatura hərəkəti səsi bərpa etməyə çalışır. Səsin həqiqətən işlədiyi yoxlanmadan “işləyir” göstərilmir. Telefon kilidi, brauzerin arxa plana keçməsi, səssiz rejim və sistemin səsi dayandırması saytın tam idarəsində deyil. İş cihazında ekranı açıq saxlayıb real çağırışla yoxla.

## Nüsxə və sistem yoxlaması

Platforma adminində **Sistem yoxlaması və ehtiyat nüsxə** bölməsi var. Baza bağlantısı, giriş qaydalarının vəziyyəti və nüsxə işinin son nəticəsi göstərilir. Quraşdırma `EHTIYAT_NUSXE_028.md` daxilindədir. Faylların surətinin götürülməsi, bazanın ehtiyat nüsxəsi və ayrıca bərpa sınağı fərqli yoxlamalardır.

## Deploy sonrası qısa sınaq

1. İki telefondan eyni masaya sifariş ver; hər telefon öz sifarişlərini görsün, masa üzrə yekun ortaq olsun.
2. Bir məhsulu 0 et, digərinin sayını azalt; müştəri və mətbəxdə yenilə. Tam ləğvi də yoxla.
3. Boş masaya köçür, köhnə QR-dakı müştərinin sifarişinin eyni hesabda qaldığını yoxla.
4. Sahibdən endirim/servis ver; ofisiant hesabında bu düymənin olmadığını yoxla.
5. İki hissə ilə kart/nağd ödə, son hissədə masanın bağlandığını və tarixçə/Excel yekununun eyni olduğunu yoxla.
6. Səsi aktiv et, refresh et, yeni çağırış göndər. Brauzer toxunuş istəyirsə bir dəfə ekrana toxun.
7. Açıq və bağlanmış hesabın çapını öz printerində yoxla.
8. Yüklənmiş menyu şəkillərini, yeni sifarişi, şifrə bərpasını və radiusu öz deployunda yoxla.
