# Restaurant SaaS — yoxlama və işə salma

Bu repository əsas Next.js tətbiqidir. Köhnə tarixli `*-2026-*` qovluqları olan ZIP-lər **tam layihə deyil**, ayrıca yeniləmə paketləridir; onları bütöv tətbiq kimi işə salmayın və artıq birləşdirilmiş faylların üzərinə kor-koranə köçürməyin.

## Lokal işə salma

1. Node.js 22 və npm quraşdırın.
2. `npm ci` icra edin.
3. `.env.local` yaradın. Mövcud kodun istifadə etdiyi Supabase environment dəyişənlərini öz layihənizdən əlavə edin (heç bir secret-i GitHub-a commit etməyin).
4. `npm run dev` — sonra http://localhost:3000 açın.
5. Yoxlama: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

## Verilənlər bazası

Yeni Supabase layihəsində `supabase/migrations/001_*.sql`-dan `024_*.sql`-a qədər **nömrə ardıcıllığı ilə** tətbiq edin. Mövcud bazada artıq hansı miqrasiyaların icra olunduğunu yoxlayın və yalnız çatışmayanları tətbiq edin. `supabase/updates/024_all_updates.sql` ayrıca birləşmiş yeniləmə faylıdır — eyni əməliyyatları iki dəfə kor-koranə tətbiq etməyin. Mümkünsə əvvəlcə test bazasında işlədin.

## Əsas yoxlama ssenariləri

1. Restoran yaradın, filial əlavə edin, 20 masa toplu yaradın və QR-ləri çap edin.
2. QR ilə sifariş edin; eyni masa üçün ayrıca telefonlardan gələn sifarişləri izləyin.
3. QR istifadə etməyən müştəri üçün ofisiantın sifariş panelindən masa seçərək sifariş yaradın.
4. Mətbəx ekranında sifarişlərin görünməsini və status dəyişməsini yoxlayın.
5. Masa hesabı, ödəniş, hesab tarixçəsi və satış hesabatlarını yoxlayın.
6. OWNER / WAITER / KITCHEN rollarının yalnız icazəli ekran və əməliyyatlara girişini yoxlayın.
7. Eyni sifariş və masa yaratma sorğusunu təkrarlayaraq ikiqat qeyd yaranmadığını yoxlayın.

**Status:** Bu bəndlər əl ilə icra olunana və GitHub Actions yoxlamaları uğurla bitənə qədər tətbiq production-ready sayılmamalıdır.
