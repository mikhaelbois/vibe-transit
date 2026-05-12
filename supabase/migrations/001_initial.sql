-- sync_runs: records every sync attempt with user attribution.
--
-- Audit log note: triggered_by_* fields cover sync-level attribution.
-- Supabase also exposes auth.audit_log_entries for login/logout events at no cost.
-- TODO (future): add a standalone audit_log table for broader user activity tracking.
create table public.sync_runs (
  id                    uuid        primary key default gen_random_uuid(),
  created_at            timestamptz not null default now(),
  source_type           text        not null check (source_type in ('zip', 'api')),
  source_url            text,
  status                text        not null check (status in ('success', 'error')),
  error_message         text,
  rows_inserted         jsonb,
  duration_ms           int,
  triggered_by_user_id  uuid        references auth.users(id),
  triggered_by_email    text
);

alter table public.sync_runs enable row level security;

create policy "Authenticated users can read sync_runs"
  on public.sync_runs for select
  to authenticated using (true);

create policy "Service role can insert sync_runs"
  on public.sync_runs for insert
  to service_role with check (true);

-- stops: core GTFS stops.txt fields.
-- TODO: add stop_code, stop_url, location_type, parent_station, wheelchair_boarding
--       when full GTFS spec coverage is implemented.
create table public.stops (
  stop_id    text    primary key,
  stop_name  text,
  stop_lat   float8,
  stop_lon   float8,
  stop_desc  text,
  zone_id    text
);

alter table public.stops enable row level security;

create policy "Authenticated users can read stops"
  on public.stops for select
  to authenticated using (true);

create policy "Service role can manage stops"
  on public.stops for all
  to service_role using (true) with check (true);

-- routes: core GTFS routes.txt fields.
-- TODO: add route_desc, route_url, route_sort_order, continuous_pickup, continuous_drop_off
--       when full GTFS spec coverage is implemented.
create table public.routes (
  route_id          text primary key,
  agency_id         text,
  route_short_name  text,
  route_long_name   text,
  route_type        int,
  route_color       text
);

alter table public.routes enable row level security;

create policy "Authenticated users can read routes"
  on public.routes for select
  to authenticated using (true);

create policy "Service role can manage routes"
  on public.routes for all
  to service_role using (true) with check (true);

-- TODO: Add tables for the remaining GTFS files to reach full spec coverage:
--   trips, stop_times, calendar, calendar_dates, shapes, agency,
--   fare_attributes, fare_rules, frequencies, transfers, feed_info

-- Helper function called by the sync pipeline to wipe tables before re-insert.
-- Using security definer so the service role can call it.
-- TODO: extend this function as additional tables are added to the pipeline.
create or replace function public.truncate_gtfs_tables()
returns void
language plpgsql
security definer
as $$
begin
  truncate table public.stops, public.routes;
end;
$$;

grant execute on function public.truncate_gtfs_tables() to service_role;
