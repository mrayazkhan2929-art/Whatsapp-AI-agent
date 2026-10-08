-- Phase 6: additive tenant-owned routing; historical 020 remains unchanged.
create table public.agent_routing_rules (
 id uuid primary key default gen_random_uuid(), org_id uuid not null references public.organizations(id) on delete cascade,
 name text not null, priority integer not null default 100,
 team_member_id uuid not null references public.team_members(id) on delete cascade,
 areas text[] not null default '{}', min_budget numeric not null default 0 check(min_budget>=0),
 max_budget numeric check(max_budget>=min_budget), active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.team_members add column available boolean not null default true;
-- Optional weekly availability: timezone, days (0=Sunday), start/end HH:mm. Missing hours means always available.
alter table public.team_members add column working_hours jsonb;
create function public.validate_agent_routing_rule() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from public.team_members where id=new.team_member_id and org_id=new.org_id) then
  raise exception using errcode='PT404',message='Team member not found';
 end if;
 return new;
end $$;
create trigger agent_routing_rule_tenant before insert or update on public.agent_routing_rules for each row execute function public.validate_agent_routing_rule();
alter table public.agent_routing_rules enable row level security;
revoke all on public.agent_routing_rules from anon,authenticated;
grant all on public.agent_routing_rules to service_role;
revoke all on function public.validate_agent_routing_rule() from public,anon,authenticated;
grant execute on function public.validate_agent_routing_rule() to service_role;
