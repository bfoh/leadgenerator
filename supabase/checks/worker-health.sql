-- Is the scheduled background worker running? READ ONLY: one SELECT that calls no writing function,
-- so it changes nothing; the SQL editor shows its result because it is the only statement. Run it
-- after scheduling the worker (RUNBOOK §7), which enables pg_cron and pg_net. It shows the schedule,
-- its recent runs, the worker route's HTTP answers (counts only) and which jobs the worker ran, so the
-- "close the browser" acceptance test can be checked from data. No business details are returned.
select section, item, value
from (
  select 1 as ord, 'schedule' as section, 'automation-worker (schedule, state)' as item,
    coalesce((select schedule || ', ' || case when active then 'active' else 'inactive' end from cron.job where jobname = 'automation-worker'), 'not scheduled') as value
  union all select 2, 'schedule', 'runs in the last hour (succeeded / failed)',
    (select count(*) filter (where d.status = 'succeeded') || ' / ' || count(*) filter (where d.status = 'failed') from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'automation-worker' and d.start_time > now() - interval '1 hour')
  union all select 3, 'schedule', 'latest run (start, status)',
    coalesce((select d.start_time::text || ', ' || d.status from cron.job_run_details d join cron.job j on j.jobid = d.jobid where j.jobname = 'automation-worker' order by d.start_time desc limit 1), 'never')
  union all select 4, 'worker route', 'HTTP answers in the last hour (200 = ran; 401 = wrong secret; 503 = not configured; timeout = pg_net stopped waiting, RUNBOOK §7)',
    (select coalesce(string_agg(code || ' ' || n, ', ' order by code), 'none') from (select coalesce(status_code::text, case when timed_out then 'timeout' else 'error' end) as code, count(*) as n from net._http_response where created > now() - interval '1 hour' group by 1) s)
  union all select 5, 'worker route', 'latest answer (counts only)',
    coalesce((select left(coalesce(r.content, r.error_msg, ''), 200) from net._http_response r order by r.created desc limit 1), 'none')
  union all select 6, 'jobs', 'run by the background worker in the last 24 h (by agent)',
    (select coalesce(string_agg(agent || ' ' || n, ', ' order by agent), 'none') from (select agent, count(*) as n from public.agent_runs where worker = 'cron' and started_at > now() - interval '24 hours' group by agent) s)
  union all select 7, 'jobs', 'latest background run',
    coalesce((select max(started_at)::text from public.agent_runs where worker = 'cron'), 'never')
  union all select 8, 'jobs', 'run from the app (Run buttons) in the last 24 h',
    (select count(*)::text from public.agent_runs where worker is distinct from 'cron' and started_at > now() - interval '24 hours')
  union all select 9, 'jobs', 'overdue (claimable and due for over five minutes)',
    (select count(*)::text from public.automation_jobs j join public.automation_settings s on s.organization_id = j.organization_id
      where j.status = 'pending' and not j.cancel_requested and j.run_after < now() - interval '5 minutes'
        and not s.paused and not (j.agent = any (s.disabled_agents)) and j.agent <> 'outreach_execution')
  union all select 10, 'jobs', 'open jobs by status',
    (select coalesce(string_agg(status || ' ' || n, ', ' order by status), 'none') from (select status, count(*) as n from public.automation_jobs where status in ('pending', 'running', 'awaiting_approval') group by status) s)
) health
order by ord;
