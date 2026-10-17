-- One-time cleanup. Only known generated revision assignments are removed.
delete from public.tasks where title ilike 'Fortnightly revision:%';
delete from public.revision_records r where not exists (select 1 from public.tasks t where t.revision_id = r.id);
delete from public.weekly_boards b where not exists (select 1 from public.tasks t where t.board_id = b.id)
  and b.week_start < current_date;
