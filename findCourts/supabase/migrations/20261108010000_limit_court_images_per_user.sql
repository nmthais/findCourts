create function public.enforce_court_image_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if (
        select count(*)
        from public.court_images
        where court_id = new.court_id
          and uploaded_by_firebase_uid = new.uploaded_by_firebase_uid
    ) >= 5 then
        raise exception 'A user can upload up to 5 photos for each court.'
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

create trigger enforce_court_image_limit_before_insert
before insert on public.court_images
for each row execute function public.enforce_court_image_limit();

revoke all on function public.enforce_court_image_limit() from public, anon, authenticated;
