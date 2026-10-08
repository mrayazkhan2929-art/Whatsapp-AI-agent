begin;
alter table public.contacts add constraint contacts_state_owner unique(org_id,id);
alter table public.conversations add constraint conversations_state_owner unique(org_id,id,contact_id);
create table public.conversation_states (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  language text not null default 'en' check (language in ('en','ar')),
  criteria jsonb not null default '{"excludeRefs":[]}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  shown_property_refs text[] not null default '{}',
  schema_version integer not null default 1 check (schema_version = 1),
  revision integer not null default 1 check (revision > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(org_id,contact_id) references public.contacts(org_id,id) on delete cascade,
  foreign key(org_id,conversation_id,contact_id) references public.conversations(org_id,id,contact_id) on delete cascade
);
create index conversation_states_tenant_contact on public.conversation_states(org_id, contact_id);
alter table public.conversation_states enable row level security;
revoke all on public.conversation_states from public, anon, authenticated;
grant all on public.conversation_states to service_role;

-- The conversation lock serializes first insert and CAS updates across all processes.
-- PT409 is intentional: PostgREST 14 retries SQLSTATE 40001 indefinitely.
create function public.save_conversation_state(
  p_org_id uuid, p_conversation_id uuid, p_contact_id uuid, p_expected_revision integer,
  p_criteria jsonb, p_shown_refs text[], p_language text
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_revision integer; v_legacy jsonb; v_key text; v_value text; v_state public.conversation_states;
begin
  perform 1 from public.conversations c join public.contacts t on t.id=c.contact_id and t.org_id=c.org_id
    where c.id=p_conversation_id and c.org_id=p_org_id and c.contact_id=p_contact_id for update of c;
  if not found then raise sqlstate 'P0002' using message='Conversation was not found'; end if;
  select revision into v_revision from public.conversation_states where conversation_id=p_conversation_id and org_id=p_org_id for update;
  if coalesce(v_revision,0) <> p_expected_revision then raise sqlstate 'PT409' using message='Conversation state changed'; end if;
  if jsonb_typeof(p_criteria) <> 'object' or p_language not in ('en','ar') or cardinality(p_shown_refs)>2000
    then raise sqlstate '22023' using message='Invalid conversation state'; end if;
  insert into public.conversation_states(conversation_id,org_id,contact_id,criteria,shown_property_refs,language,revision)
    values(p_conversation_id,p_org_id,p_contact_id,p_criteria,p_shown_refs,p_language,coalesce(v_revision,0)+1)
    on conflict(conversation_id) do update set criteria=excluded.criteria,shown_property_refs=excluded.shown_property_refs,
      language=excluded.language,revision=excluded.revision,updated_at=now()
    returning * into v_state;
  v_legacy := jsonb_build_object('area',p_criteria->'area','bedrooms',p_criteria->'bedrooms',
    'minBudget',p_criteria->'minPrice','maxBudget',p_criteria->'maxPrice','transactionType',p_criteria->'transactionType',
    'propertyType',p_criteria->'propertyType','referenceNumber',p_criteria->'referenceNumber','project',p_criteria->'project',
    'building',p_criteria->'building','status',p_criteria->'status','developer',p_criteria->'developer',
    'distressOnly',p_criteria->'distressOnly','language',p_language,
    'intent',case p_criteria->>'transactionType' when 'SALE' then 'buy' when 'RENT' then 'rent' else 'unknown' end,
    'lastShownPropertyRefs',array_to_string(p_shown_refs,','));
  update public.contacts set contact_memory=contact_memory || v_legacy,updated_at=now() where id=p_contact_id and org_id=p_org_id;
  for v_key,v_value in select key,coalesce(value,'') from jsonb_each_text(v_legacy) loop
    insert into public.contact_memory(contact_id,key,value,updated_at) values(p_contact_id,v_key,v_value,now())
      on conflict(contact_id,key) do update set value=excluded.value,updated_at=now();
  end loop;
  return to_jsonb(v_state);
end;
$$;
revoke all on function public.save_conversation_state(uuid,uuid,uuid,integer,jsonb,text[],text) from public,anon,authenticated;
grant execute on function public.save_conversation_state(uuid,uuid,uuid,integer,jsonb,text[],text) to service_role;
-- Legacy stores are preserved. Typed backfill is lazy, after ownership checks and application validation.
commit;
