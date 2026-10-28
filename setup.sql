-- ============================================================
-- SEMS (formerly SinoVotes) — Security & RPC setup
-- Run this in the Supabase SQL editor AFTER your tables exist.
-- It does not create tables — it locks them down and adds the
-- three functions the website calls: cast_vote, get_results,
-- verify_receipt, get_turnout.
--
-- ASSUMPTIONS (adjust if your real column names differ):
--   election_voters.student_number  -> holds the same value as
--                                       students.exam_number
--   elections.status                -> text/enum with values
--                                       'scheduled' | 'open' |
--                                       'closed' | 'completed'
--   candidates.full_name, manifesto, photo_url
--   positions.name, display_order
-- ============================================================

-- 1. Lock every table down by default -------------------------
alter table elections        enable row level security;
alter table positions        enable row level security;
alter table candidates       enable row level security;
alter table announcements    enable row level security;
alter table votes            enable row level security;
alter table election_voters  enable row level security;
alter table students         enable row level security;
alter table admins           enable row level security;

-- 2. Public (anon) read access — only what students need to browse
drop policy if exists "public read elections" on elections;
create policy "public read elections" on elections
  for select using (true);

drop policy if exists "public read positions" on positions;
create policy "public read positions" on positions
  for select using (true);

drop policy if exists "public read candidates" on candidates;
create policy "public read candidates" on candidates
  for select using (true);

drop policy if exists "public read published announcements" on announcements;
create policy "public read published announcements" on announcements
  for select using (published = true);

-- Deliberately NO anon policies on: students, election_voters, votes.
-- The RPCs below are SECURITY DEFINER, so they can read/write those
-- tables even though anon has no direct access — this is what stops
-- someone from opening devtools and reading who has voted, or how.

-- 3. Admin (authenticated + present in `admins`) full access ---
drop policy if exists "admins manage elections" on elections;
create policy "admins manage elections" on elections for all
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins manage positions" on positions;
create policy "admins manage positions" on positions for all
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins manage candidates" on candidates;
create policy "admins manage candidates" on candidates for all
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins manage announcements" on announcements;
create policy "admins manage announcements" on announcements for all
  using (exists (select 1 from admins a where a.id = auth.uid()))
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins read students" on students;
create policy "admins read students" on students for select
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins manage students" on students;
create policy "admins manage students" on students for insert
  with check (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins read election_voters" on election_voters;
create policy "admins read election_voters" on election_voters for select
  using (exists (select 1 from admins a where a.id = auth.uid()));

drop policy if exists "admins read votes" on votes;
create policy "admins read votes" on votes for select
  using (exists (select 1 from admins a where a.id = auth.uid()));

-- Note: this must check auth.uid() = id directly, not a subquery on
-- admins itself — a subquery there is circular (you'd need to already
-- be provably an admin to read the admins table to prove you're an
-- admin) and Supabase's RLS will just block the read.
drop policy if exists "admins read admins" on admins;
create policy "admins read admins" on admins for select
  using (auth.uid() = id);

-- 4. cast_vote — the whole ballot, atomically -------------------
-- p_selections shape: [{"position_id":"uuid","candidate_id":"uuid"}, ...]
-- One row per position in the election is required, or the whole
-- thing is rejected. Raises a short error code on failure; the
-- website maps these to friendly messages.
create or replace function public.cast_vote(
  p_election_id uuid,
  p_exam_number text,
  p_selections jsonb
) returns table(receipt_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_student_exists boolean;
  v_has_voted     boolean;
  v_expected_count int;
  v_given_count    int;
  v_receipt        text;
  v_sel            jsonb;
begin
  select status into v_status from elections where id = p_election_id;
  if v_status is null then
    raise exception 'ELECTION_NOT_FOUND';
  end if;
  if v_status <> 'open' then
    raise exception 'ELECTION_NOT_OPEN';
  end if;

  select true into v_student_exists from students where exam_number = p_exam_number;
  if v_student_exists is null then
    raise exception 'INVALID_EXAM_NUMBER';
  end if;

  -- Serialize concurrent attempts from the same student for this election
  perform 1 from election_voters
    where election_id = p_election_id and student_number = p_exam_number
    for update;

  select has_voted into v_has_voted
    from election_voters
    where election_id = p_election_id and student_number = p_exam_number;

  if v_has_voted is true then
    raise exception 'ALREADY_VOTED';
  end if;

  if v_has_voted is null then
    insert into election_voters (election_id, student_number, has_voted)
    values (p_election_id, p_exam_number, false);
  end if;

  select count(*) into v_expected_count from positions where election_id = p_election_id;
  select count(*) into v_given_count from jsonb_array_elements(p_selections);
  if v_given_count <> v_expected_count or v_expected_count = 0 then
    raise exception 'INCOMPLETE_BALLOT';
  end if;

  v_receipt := 'SV-' || to_char(now(), 'YYYY') || '-' ||
               upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));

  for v_sel in select * from jsonb_array_elements(p_selections)
  loop
    -- guard against a candidate that doesn't belong to the position, or
    -- a position that doesn't belong to this election
    if not exists (
      select 1 from candidates c
      join positions p on p.id = c.position_id
      where c.id = (v_sel->>'candidate_id')::uuid
        and p.id = (v_sel->>'position_id')::uuid
        and p.election_id = p_election_id
    ) then
      raise exception 'INVALID_SELECTION';
    end if;

    insert into votes (election_id, position_id, candidate_id)
    values (p_election_id, (v_sel->>'position_id')::uuid, (v_sel->>'candidate_id')::uuid);
  end loop;

  update election_voters
  set has_voted = true, voted_at = now(), receipt_id = v_receipt
  where election_id = p_election_id and student_number = p_exam_number;

  return query select v_receipt;
end;
$$;

grant execute on function public.cast_vote(uuid, text, jsonb) to anon;

-- 5. get_results — only returns rows once the election is closed
create or replace function public.get_results(p_election_id uuid)
returns table(
  position_id uuid,
  position_name text,
  candidate_id uuid,
  candidate_name text,
  vote_count bigint
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.name, c.id, c.full_name, count(v.id)
  from positions p
  join candidates c on c.position_id = p.id
  left join votes v on v.candidate_id = c.id
  join elections e on e.id = p.election_id
  where p.election_id = p_election_id
    and e.status in ('closed', 'completed')
  group by p.id, p.name, c.id, c.full_name
  order by p.display_order, count(v.id) desc;
$$;

grant execute on function public.get_results(uuid) to anon;

-- 6. verify_receipt — confirms a receipt is real without revealing choices
create or replace function public.verify_receipt(p_receipt_id text)
returns table(election_title text, voted_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select e.title, ev.voted_at
  from election_voters ev
  join elections e on e.id = ev.election_id
  where ev.receipt_id = p_receipt_id;
$$;

grant execute on function public.verify_receipt(text) to anon;

-- 7. get_turnout — safe aggregate counts for the home page / dashboard
create or replace function public.get_turnout(p_election_id uuid)
returns table(eligible bigint, voted bigint)
language sql
security definer
set search_path = public
as $$
  select
    (select count(*) from students) as eligible,
    (select count(*) from election_voters
       where election_id = p_election_id and has_voted) as voted;
$$;

grant execute on function public.get_turnout(uuid) to anon;

-- 8. admin_delete_election — full cascading delete for the committee
-- dashboard's "Delete" button. Removes votes, election_voters,
-- candidates, positions, then the election itself, in that order (to
-- respect foreign keys), in one transaction. SECURITY DEFINER because
-- votes/election_voters intentionally have no direct anon or admin
-- policies — this is the one sanctioned way to clear them, and it
-- checks admin membership itself before doing anything.
create or replace function public.admin_delete_election(p_election_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from admins where id = auth.uid()) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  delete from votes where election_id = p_election_id;
  delete from election_voters where election_id = p_election_id;
  delete from candidates where position_id in (select id from positions where election_id = p_election_id);
  delete from positions where election_id = p_election_id;
  delete from elections where id = p_election_id;
end;
$$;

grant execute on function public.admin_delete_election(uuid) to authenticated;

-- 9. auto_transition_elections — flips status automatically at the
-- right time, so nobody has to manually click "Open"/"Closed" at the
-- exact minute. Run this on a schedule (see instructions below).
create or replace function public.auto_transition_elections()
returns void
language sql
security definer
set search_path = public
as $$
  update elections set status = 'open'
    where status = 'scheduled' and start_time <= now();

  update elections set status = 'closed'
    where status = 'open' and end_time <= now();
$$;

-- To actually run this every minute, enable the pg_cron extension:
--   Supabase Dashboard → Database → Extensions → search "pg_cron" → Enable
-- then run this once (only after pg_cron is enabled, or it will error):
--
--   select cron.schedule(
--     'sinovotes-auto-transition',
--     '* * * * *',
--     $$select public.auto_transition_elections()$$
--   );
--
-- Without this scheduled job, election status changes still have to be
-- made by hand from the dashboard (or the "waiting for the committee to
-- open voting" message on the home page will just wait indefinitely).

-- 10. Candidate photo storage — a public bucket admins can upload to.
-- Public because candidate photos are meant to be visible to every
-- student browsing the ballot with no login; only admins can write to it.
insert into storage.buckets (id, name, public)
values ('candidate-photos', 'candidate-photos', true)
on conflict (id) do nothing;

drop policy if exists "public read candidate photos" on storage.objects;
create policy "public read candidate photos" on storage.objects
  for select using (bucket_id = 'candidate-photos');

drop policy if exists "admins upload candidate photos" on storage.objects;
create policy "admins upload candidate photos" on storage.objects
  for insert with check (
    bucket_id = 'candidate-photos'
    and exists (select 1 from admins a where a.id = auth.uid())
  );

drop policy if exists "admins delete candidate photos" on storage.objects;
create policy "admins delete candidate photos" on storage.objects
  for delete using (
    bucket_id = 'candidate-photos'
    and exists (select 1 from admins a where a.id = auth.uid())
  );

-- 11. Nomination vetting — store why a nomination was rejected --
alter table candidates add column if not exists rejection_reason text;
