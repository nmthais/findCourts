create index reviews_user_history_idx
    on public.reviews (firebase_uid, created_at desc, id desc);
create index court_images_user_history_idx
    on public.court_images (uploaded_by_firebase_uid, created_at desc, id desc);
