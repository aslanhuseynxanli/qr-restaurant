-- Yalnız yeni TEST bazasının bərpası üçün; normal 025 quraşdırmasında işlətmə.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
drop policy if exists menu_images_owner_insert on storage.objects;
create policy menu_images_owner_insert on storage.objects for insert to authenticated
with check (bucket_id='menu-images' and private.can_upload_menu_image(name));
-- Klon köhnə bərpa icazələrini və cəhd limitlərini daşımamalıdır.
delete from private.account_recovery_grants;
delete from private.account_auth_limits;
