create function public.get_court_review_summary(target_court_id text)
returns table(review_count bigint, average_rating numeric)
language sql
stable
set search_path = ''
as $$
    select count(*), avg(rating)::numeric
    from public.reviews
    where court_id = target_court_id;
$$;

revoke all on function public.get_court_review_summary(text) from public, anon, authenticated;
grant execute on function public.get_court_review_summary(text) to service_role;
