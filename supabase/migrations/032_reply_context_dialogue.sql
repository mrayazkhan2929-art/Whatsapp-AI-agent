begin;
-- Additive dialogue storage. The v1 criteria and compatibility RPC stay unchanged.
alter table public.conversation_states add column dialogue jsonb not null default '{}'::jsonb
  check (jsonb_typeof(dialogue)='object' and octet_length(dialogue::text)<=16000);
alter table public.messages add column execution_order bigint generated always as identity;
alter table public.messages add column execution_started_at timestamptz;
alter table public.messages add column execution_generation bigint;
alter table public.messages add column execution_owner uuid;
create index whatsapp_conversation_execution_queue on public.messages(org_id,conversation_id,execution_order)
  where direction='inbound' and processing_status in ('received','processing','prepared','sending');

create function public.load_reply_context(p_org_id uuid,p_device_id uuid,p_conversation_id uuid,p_inbound_id uuid default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.conversations; t public.contacts; a public.agents; v public.agent_versions;
  s public.conversation_states; cutoff bigint; h jsonb; legacy jsonb; profile jsonb;
begin
  select x.* into c from public.conversations x where x.id=p_conversation_id and x.org_id=p_org_id;
  if not found then raise sqlstate 'P0002' using message='Conversation not found';end if;
  select * into t from public.contacts where id=c.contact_id and org_id=p_org_id;
  if not found or not exists(select 1 from public.devices where id=p_device_id and org_id=p_org_id)
    or (c.device_id is not null and not exists(select 1 from public.devices where id=c.device_id and org_id=p_org_id))
    or (c.assigned_to is not null and not exists(select 1 from public.team_members where id=c.assigned_to and org_id=p_org_id))
    or (t.assigned_to is not null and not exists(select 1 from public.team_members where id=t.assigned_to and org_id=p_org_id))
    then raise sqlstate 'P0002' using message='Linked resource not found';end if;
  if p_inbound_id is not null then
    select execution_order into cutoff from public.messages where id=p_inbound_id and org_id=p_org_id
      and conversation_id=c.id and device_id=p_device_id and direction='inbound';
    if not found then raise sqlstate 'P0002' using message='Inbound not found';end if;
  end if;
  select x.* into a from public.agents x join public.agent_channel_links l on l.agent_id=x.id and l.org_id=x.org_id
    where l.org_id=p_org_id and l.device_id=p_device_id and x.active;
  if not found or a.published_version_id is null then raise sqlstate 'PT409' using message='Published channel agent required';end if;
  select * into v from public.agent_versions where id=a.published_version_id and agent_id=a.id and org_id=p_org_id;
  if not found then raise sqlstate 'P0002' using message='Published version not found';end if;
  if exists(select 1 from jsonb_array_elements_text(v.config->'knowledgeBaseIds') k
    where not exists(select 1 from public.knowledge_bases where id=k.value::uuid and org_id=p_org_id))
    or (nullif(v.config->>'defaultFlowId','') is not null and not exists(select 1 from public.flows where id=(v.config->>'defaultFlowId')::uuid and org_id=p_org_id))
    or (nullif(v.config#>>'{handoffPolicy,defaultMemberId}','') is not null and not exists(select 1 from public.team_members where id=(v.config#>>'{handoffPolicy,defaultMemberId}')::uuid and org_id=p_org_id and active))
    then raise sqlstate 'P0002' using message='Agent reference not found';end if;
  select * into s from public.conversation_states where conversation_id=c.id and org_id=p_org_id;
  if found and s.contact_id<>t.id then raise sqlstate 'P0002' using message='State parent not found';end if;
  -- A malformed child must never become history through a valid conversation.
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.execution_order),'[]') into h from (
    select m.id,m.direction,m.content,m.status,m.execution_order,m.created_at from public.messages m
    where m.org_id=p_org_id and m.conversation_id=c.id and (cutoff is null or m.execution_order<cutoff
      or (m.direction='outbound' and exists(select 1 from public.messages previous where previous.id=m.reply_to_message_id and previous.org_id=p_org_id and previous.conversation_id=c.id and previous.execution_order<cutoff)))
      and (m.direction='inbound' or m.status in ('sent','delivered','read'))
      and (m.device_id is null or exists(select 1 from public.devices d where d.id=m.device_id and d.org_id=p_org_id))
      and (m.reply_to_message_id is null or exists(select 1 from public.messages parent where parent.id=m.reply_to_message_id and parent.org_id=p_org_id and parent.conversation_id=c.id))
    order by m.created_at desc,m.execution_order desc limit 12
  ) r;
  select coalesce(jsonb_object_agg(key,value),'{}') into legacy from public.contact_memory where contact_id=t.id;
  select to_jsonb(x) into profile from public.organization_profiles x where org_id=p_org_id;
  return jsonb_build_object('conversation',to_jsonb(c),'contact',jsonb_build_object('id',t.id,'org_id',t.org_id,'phone',t.phone,'name',t.name,'language',t.language,'contact_memory',coalesce(t.contact_memory,'{}')||legacy),
    'history',h,'state',case when s.conversation_id is null then null else to_jsonb(s) end,
    'companyProfile',profile,'agentId',a.id,'agentVersionId',v.id,'versionNumber',v.version_number,'config',v.config);
end $$;

create function public.save_reply_dialogue(p_org_id uuid,p_conversation_id uuid,p_contact_id uuid,p_expected_revision integer,
 p_criteria jsonb,p_shown_refs text[],p_language text,p_dialogue jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if jsonb_typeof(p_dialogue)<>'object' or octet_length(p_dialogue::text)>16000 then raise sqlstate '22023' using message='Invalid dialogue';end if;
  result:=public.save_conversation_state(p_org_id,p_conversation_id,p_contact_id,p_expected_revision,p_criteria,p_shown_refs,p_language);
  update public.conversation_states set dialogue=p_dialogue where org_id=p_org_id and conversation_id=p_conversation_id and contact_id=p_contact_id;
  return result||jsonb_build_object('dialogue',p_dialogue);
end $$;

-- Lock the parent across processes before choosing the next admitted inbound.
create function public.prepare_reply_response(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid,p_text text,p_outbound_wa_id text,p_metadata jsonb,p_match_metadata jsonb,p_state jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.messages;
begin
  select * into m from public.messages where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' for update;
  if not found then raise sqlstate 'P0002' using message='Inbound not found';end if;
  if exists(select 1 from public.messages where reply_to_message_id=m.id and org_id=p_org_id) then
    return public.prepare_whatsapp_response(p_org_id,p_device_id,p_message_id,p_token,p_text,p_outbound_wa_id,p_metadata,p_match_metadata);
  end if;
  if m.processing_status<>'processing' or m.claim_token is distinct from p_token then raise sqlstate 'PT409' using message='Execution claim lost';end if;
  perform public.save_reply_dialogue(p_org_id,m.conversation_id,(p_state->>'contactId')::uuid,(p_state->>'expectedRevision')::integer,
    p_state->'criteria',array(select jsonb_array_elements_text(p_state->'shownRefs')),p_state->>'language',p_state->'dialogue');
  -- State and prepared response commit together. Human/lease guards roll both back.
  return public.prepare_whatsapp_response(p_org_id,p_device_id,p_message_id,p_token,p_text,p_outbound_wa_id,p_metadata,p_match_metadata);
end $$;
create or replace function public.claim_whatsapp_execution(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.messages; c public.conversations;
begin
  select x.* into c from public.conversations x join public.messages q on q.conversation_id=x.id and q.org_id=x.org_id
    where q.id=p_message_id and q.org_id=p_org_id and q.device_id=p_device_id for update of x;
  if not found then return null;end if;
  select * into m from public.messages where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' and processing_status='received';
  if not found then return null;end if;
  if exists(select 1 from public.messages q where q.org_id=p_org_id and q.conversation_id=c.id and q.direction='inbound'
      and ((q.processing_status in ('processing','prepared','sending')) or (q.processing_status='received' and q.execution_order<m.execution_order))) then return null;end if;
  update public.messages set processing_status='processing',claim_token=p_token,execution_started_at=clock_timestamp(),
    execution_generation=(select generation from public.device_runtime_leases where org_id=p_org_id and device_id=p_device_id and lease_until>clock_timestamp()),
    execution_owner=(select owner_id from public.device_runtime_leases where org_id=p_org_id and device_id=p_device_id and lease_until>clock_timestamp())
    where id=m.id returning * into m;
  return to_jsonb(m);
end $$;

-- After a fenced owner restart, unknown executions go to review; never rerun them.
create function public.admit_whatsapp_execution(p_org_id uuid,p_device_id uuid,p_wa_message_id text,p_jid text,p_phone text,p_name text,p_content text,p_type text,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m jsonb; claimed jsonb;
begin
  m:=public.receive_whatsapp_message(p_org_id,p_device_id,p_wa_message_id,p_jid,p_phone,p_name,p_content,p_type);
  claimed:=public.claim_whatsapp_execution(p_org_id,p_device_id,(m->>'id')::uuid,p_token);
  return jsonb_build_object('message',m,'claimed',claimed is not null);
end $$;
create function public.recover_reply_executions(p_org_id uuid,p_device_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare lease public.device_runtime_leases;
begin
  select * into lease from public.device_runtime_leases where org_id=p_org_id and device_id=p_device_id and owner_id is not null and lease_until>clock_timestamp();
  if not found then return;end if;
  update public.messages set processing_status='needs_review',failure_code='EXECUTION_OWNER_RESTARTED',processed_at=clock_timestamp()
    where org_id=p_org_id and device_id=p_device_id and direction='inbound' and processing_status='processing'
    and execution_generation is not null and (execution_generation<>lease.generation or execution_owner is distinct from lease.owner_id);
  update public.messages parent set processing_status='needs_review',failure_code='SEND_OUTCOME_UNKNOWN',processed_at=clock_timestamp()
    where parent.org_id=p_org_id and parent.device_id=p_device_id and parent.direction='inbound' and parent.processing_status='prepared'
    and parent.execution_generation is not null and (parent.execution_generation<>lease.generation or parent.execution_owner is distinct from lease.owner_id)
    and exists(select 1 from public.messages child where child.reply_to_message_id=parent.id and child.org_id=p_org_id and child.device_id=p_device_id and child.processing_status='sending');
  update public.messages child set processing_status='needs_review',failure_code='SEND_OUTCOME_UNKNOWN',processed_at=clock_timestamp()
    where child.org_id=p_org_id and child.device_id=p_device_id and child.direction='outbound' and child.processing_status='sending'
    and exists(select 1 from public.messages parent where parent.id=child.reply_to_message_id and parent.org_id=p_org_id and parent.processing_status='needs_review');
end $$;
create function public.guard_reply_execution_owner() returns trigger language plpgsql set search_path='' as $$
declare parent public.messages;
begin
  if new.direction='outbound' and new.sender_type='ai' and new.reply_to_message_id is not null then
    select * into parent from public.messages where id=new.reply_to_message_id and org_id=new.org_id and conversation_id=new.conversation_id;
    if not found then raise sqlstate 'P0002' using message='Reply parent not found';end if;
    if parent.execution_generation is not null and not exists(select 1 from public.device_runtime_leases where org_id=new.org_id and device_id=new.device_id
      and generation=parent.execution_generation and owner_id=parent.execution_owner and lease_until>clock_timestamp())
      then raise sqlstate 'PT409' using message='Execution owner lost';end if;
  end if;
  return new;
end $$;
create trigger reply_execution_owner_guard before insert on public.messages for each row execute function public.guard_reply_execution_owner();

create or replace function public.claim_whatsapp_send(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.messages; c public.conversations;
begin
  select v.* into c from public.conversations v join public.messages x on x.conversation_id=v.id and x.org_id=v.org_id where x.id=p_message_id and x.org_id=p_org_id and x.device_id=p_device_id for update of v;
  if not found then return null;end if;
  if c.handoff_state in ('HUMAN_ACTIVE','RESOLVED') or (c.handled_by='human' and c.handoff_state='AI_ACTIVE') then
    update public.messages set processing_status='ignored',failure_code='HUMAN_HANDOFF',processed_at=now() where id=p_message_id and org_id=p_org_id and device_id=p_device_id and processing_status='prepared' returning * into m;
    if found then update public.messages set processing_status='ignored',failure_code='HUMAN_HANDOFF',processed_at=now() where id=m.reply_to_message_id and org_id=p_org_id and device_id=p_device_id and processing_status='prepared';end if;
    return null;
  end if;
  update public.messages set processing_status='sending',claim_token=p_token where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='outbound' and processing_status='prepared' returning * into m;
  return case when found then to_jsonb(m) else null end;
end $$;

revoke all on function public.load_reply_context(uuid,uuid,uuid,uuid),public.save_reply_dialogue(uuid,uuid,uuid,integer,jsonb,text[],text,jsonb) from public,anon,authenticated;
grant execute on function public.load_reply_context(uuid,uuid,uuid,uuid),public.save_reply_dialogue(uuid,uuid,uuid,integer,jsonb,text[],text,jsonb) to service_role;
revoke all on function public.recover_reply_executions(uuid,uuid),public.guard_reply_execution_owner() from public,anon,authenticated;
grant execute on function public.recover_reply_executions(uuid,uuid),public.guard_reply_execution_owner() to service_role;
revoke all on function public.admit_whatsapp_execution(uuid,uuid,text,text,text,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.admit_whatsapp_execution(uuid,uuid,text,text,text,text,text,text,uuid) to service_role;
revoke all on function public.prepare_reply_response(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_reply_response(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
