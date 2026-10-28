# SEMS — SINOZAM ELECTIONS MANAGEMENT SYSTEM

*Formerly SinoVotes · New identity effective 10 October 2026*

SEMS handles election administration, candidate nominations and vetting,
voter registration, voting, results and announcements for Sinozam
Vocational College.

### About the rename

SEMS is the new public identity. The technical foundation (the Supabase
database, authentication, Row Level Security policies, RPC functions and
the web dashboard) is unchanged. Table names, function names, policies and
the `sinovotes-auto-transition` cron job name are intentionally kept as-is:
renaming them gives no benefit to users and would risk breaking a live
system (for example, re-scheduling the cron job under a new name without
unscheduling the old one would run the transition twice). Rename those only
as a deliberate, separate migration.

## Plain website (HTML/CSS/JS + Supabase)

This is a static website, not an app — every page is a plain `.html` file with
`supabase-js` loaded from a CDN. No build step, no Flutter. Host it anywhere
that serves static files (Vercel, Netlify, Firebase Hosting, GitHub Pages).

## 1. Connect it to your Supabase project

Open `js/supabase-config.js` and fill in:

```js
const SUPABASE_URL = "https://YOUR-PROJECT-REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-PUBLIC-KEY";
```

Both are on **Project Settings → API** in your Supabase dashboard. The anon
key is meant to be public — never put the `service_role` key in frontend code.

## 2. Run the SQL setup

Open **SQL Editor** in Supabase, paste in `sql/setup.sql`, and run it.

This does **not** create your tables (you already have those). It:
- turns on Row Level Security for every table
- adds public read access to `elections`, `positions`, `candidates`, and
  published `announcements`
- leaves `students`, `election_voters`, and `votes` with **no** public
  access at all — nobody can query them from the browser
- adds four functions the site calls instead:
  - `cast_vote(...)` — checks eligibility, checks for a duplicate vote,
    validates the ballot is complete, inserts every vote, and marks the
    student as voted, all in one atomic transaction (with row locking so
    two rapid submissions from the same student can't both get through)
  - `get_results(...)` — only returns rows once `elections.status` is
    `closed` or `completed`
  - `verify_receipt(...)` — confirms a receipt exists without exposing
    who cast it or what they chose
  - `get_turnout(...)` — safe aggregate counts for the home page and
    dashboard

## 3. Assumptions about your schema

I built this from the schema visualizer screenshot. A few things weren't
fully visible, so double-check these against your actual columns and adjust
the SQL / JS if they differ:

- `election_voters.student_number` is assumed to hold the same value as
  `students.exam_number` (that's how `cast_vote` checks eligibility)
- `elections.status` is assumed to be text with exactly these values:
  `scheduled`, `open`, `closed`, `completed`
- `candidates` is assumed to have `full_name`, `course`, `manifesto`,
  `photo_url`
- `students` is assumed to have at least `exam_number` — the ballot only
  ever sends the exam number to `cast_vote`, so extra columns (name,
  course, year) don't need any changes here

If any of these are named differently, it's a find-and-replace in
`sql/setup.sql` and the relevant `js/*.js` file.

## 4. Create your first admin account

The admins table links to `auth.users`. To register a committee member:

1. Supabase Dashboard → Authentication → Users → **Add user** (set an
   email + password)
2. Copy that user's UUID
3. In the SQL editor: `insert into admins (id, role) values ('paste-uuid-here', 'chairperson');`

They can now log in at `admin/login.html`.

## 5. What's included vs. what's next

**Included:** home page with live election status/countdown, announcements,
candidate previews, the full voting flow (select → review → exam number
verify → atomic submit → receipt), a public results page that stays hidden
until closing, receipt verification, and a committee dashboard with turnout
stats, election status control, and announcement posting.

The dashboard can now create elections, change their status, and delete
one entirely (which cleanly removes its positions, candidates, votes and
voter records too — see `admin_delete_election` in the SQL), and can
delete announcements. Positions and candidates themselves still need to
be added in Supabase's table editor for now.

**Not built yet** (the original brief's full scope is large): admin
screens for creating positions/candidates and bulk student upload — for
now those are fastest done directly in Supabase's table editor. PDF/Excel
export and automatic open/close scheduling (which need a scheduled job,
e.g. `pg_cron`, to flip `elections.status` at `start_time`/`end_time`) are
also left for a follow-up pass. Happy to build any of these next — just
say which one.

## 7. If you already ran the old setup.sql

Re-run just this part in the SQL editor to pick up the delete features and
a fix to a policy bug (the old `admins read admins` policy was
self-referential and could block your own login check):

```sql
drop policy if exists "admins read admins" on admins;
create policy "admins read admins" on admins for select
  using (auth.uid() = id);
```

Then paste in and run the new `admin_delete_election` function block from
`sql/setup.sql` (section 8) — it's additive, safe to run on top of what
you already have.

Also add section 9, `auto_transition_elections` — without it, an
election's status never flips from "Scheduled" to "Open" on its own at
start time, so the home page's countdown reaches zero and just waits
(it used to reload the page in a loop at that point; that's fixed now
too, but the fix is only in the JS — the real solution is scheduling
this function). To fully automate it, enable the `pg_cron` extension
under Database → Extensions in the Supabase dashboard, then run:

```sql
select cron.schedule(
  'sinovotes-auto-transition',
  '* * * * *',
  $$select public.auto_transition_elections()$$
);
```

Until you do that, you'll need to flip an election to "Open" (and later
"Closed") by hand from the dashboard's status dropdown at the right time.

Also run section 10 — it creates a `candidate-photos` storage bucket with
the right policies (public read, admin-only upload/delete). Without this,
the photo picker in the ballot builder will fail to upload.

## 6. Folder structure

```
index.html          Home
vote.html            Ballot: select → review → verify → submit
success.html         Receipt after voting
results.html         Results (post-close only)
verify.html          Receipt verification
admin/login.html      Committee login
admin/dashboard.html Committee dashboard
css/style.css
js/                   supabase-config.js, common.js, home.js, vote.js,
                      results.js, verify.js, admin.js
sql/setup.sql         RLS policies + RPC functions
```
