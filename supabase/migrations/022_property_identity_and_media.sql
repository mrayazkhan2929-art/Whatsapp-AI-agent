begin;
alter table public.properties add column if not exists project text;
alter table public.properties add column if not exists developer text;
alter table public.properties add constraint properties_tenant_identity unique(org_id,id);
create index properties_ref_normalized on public.properties(org_id,lower(btrim(ref)));
create index properties_ref_number_normalized on public.properties(org_id,lower(btrim(ref_number)));
-- Audit both aliases before enforcing new identities. Existing conflicts are retained
-- and exact lookup refuses them; migration never chooses a winner or deletes data.
do $$ declare v_conflicts integer; begin
  select count(*) into v_conflicts from (
    select org_id,alias from (
      select id,org_id,lower(btrim(ref)) alias from public.properties
      union select id,org_id,lower(btrim(ref_number)) from public.properties where nullif(btrim(ref_number),'') is not null
    ) identities group by org_id,alias having count(*)>1
  ) conflicts;
  raise notice 'Property identity audit: % ambiguous aliases; retained for manual reconciliation',v_conflicts;
end $$;
create function public.guard_property_identity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='UPDATE' and new.org_id=old.org_id and new.ref is not distinct from old.ref and new.ref_number is not distinct from old.ref_number then return new; end if;
  if nullif(btrim(new.ref),'') is null then raise sqlstate '22023' using message='Property reference must not be empty'; end if;
  -- Transaction advisory lock closes the concurrent insert race for all aliases in this tenant.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.org_id::text,0));
  if exists(select 1 from public.properties p where p.org_id=new.org_id and p.id<>new.id
    and (lower(btrim(p.ref))=any(array[lower(btrim(new.ref)),lower(btrim(new.ref_number))])
      or lower(btrim(p.ref_number))=any(array[lower(btrim(new.ref)),lower(btrim(new.ref_number))])))
    then raise sqlstate '23505' using message='Property reference is already in use in this organization'; end if;
  return new;
end $$;
create trigger properties_identity_guard before insert or update of org_id,ref,ref_number on public.properties for each row execute function public.guard_property_identity();
revoke all on function public.guard_property_identity() from public,anon,authenticated;
grant execute on function public.guard_property_identity() to service_role;

create table public.property_media (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  media_type text not null check(media_type in ('image','video','brochure','floor_plan','location')),
  url text not null check(url ~ '^https://[^[:space:]@]+$'),
  position integer not null default 0 check(position>=0),
  created_at timestamptz not null default now(),
  foreign key(org_id,property_id) references public.properties(org_id,id) on delete cascade,
  unique(org_id,property_id,media_type,url)
);
create index property_media_parent on public.property_media(org_id,property_id,position,id);
alter table public.property_media enable row level security;
revoke all on public.property_media from public,anon,authenticated;
grant all on public.property_media to service_role;
insert into public.property_media(org_id,property_id,media_type,url,position)
  select p.org_id,p.id,'image',url,ordinality-1 from public.properties p
  cross join lateral unnest(p.image_urls) with ordinality as image(url,ordinality)
  where url ~ '^https://[^[:space:]@]+$'
    and url !~ '^https://([0-9]+[.]|\[|localhost([/:]|$)|[^/]*[.]local([/:]|$)|[^/]*[.]localhost([/:]|$))'
    on conflict do nothing;
commit;
