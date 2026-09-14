-- Netunim bank cheque image storage v1
-- Private immutable cheque images. Binary image objects live in Storage, not in bank rows or document backups.
begin;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('bank-cheque-images','bank-cheque-images',false,5242880,array['image/jpeg','image/png','image/webp','image/gif','image/bmp']::text[])
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists netunim_bank_cheque_images_select on storage.objects;
create policy netunim_bank_cheque_images_select on storage.objects
for select to authenticated
using (bucket_id='bank-cheque-images' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists netunim_bank_cheque_images_insert on storage.objects;
create policy netunim_bank_cheque_images_insert on storage.objects
for insert to authenticated
with check (bucket_id='bank-cheque-images' and (storage.foldername(name))[1]=(select auth.uid()::text));

drop policy if exists netunim_bank_cheque_images_delete on storage.objects;
create policy netunim_bank_cheque_images_delete on storage.objects
for delete to authenticated
using (bucket_id='bank-cheque-images' and (storage.foldername(name))[1]=(select auth.uid()::text));

-- No UPDATE policy by design: image objects are immutable and deterministic.
commit;
