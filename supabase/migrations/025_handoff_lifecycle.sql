-- Durable handoff state, append-only audit, and notification outbox.
alter table public.conversations add column handoff_state text not null default 'AI_ACTIVE'
 check(handoff_state in ('AI_ACTIVE','HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT','HUMAN_ACTIVE','RESOLVED'));
alter table public.conversations add column handoff_revision integer not null default 0;
alter table public.conversations add column handoff_due_at timestamptz;
alter table public.conversations add column handoff_reason text;
update public.conversations set handoff_state='HUMAN_ACTIVE' where handled_by='human';
alter table public.handoff_events add column from_state text;
alter table public.handoff_events add column to_state text;
alter table public.handoff_events add column event_type text;
alter table public.handoff_events add column actor_id uuid references public.users(id) on delete set null;
alter table public.handoff_events add column request_key text;
create unique index handoff_request_once on public.handoff_events(org_id,conversation_id,request_key) where request_key is not null;
insert into public.handoff_events(org_id,conversation_id,contact_id,triggered_by,assigned_to,status,to_state,event_type,request_key)
select org_id,id,contact_id,'manual',case when exists(select 1 from public.team_members t where t.id=c.assigned_to and t.org_id=c.org_id) then assigned_to else null end,'accepted','HUMAN_ACTIVE','legacy_cutover','phase6-cutover'
from public.conversations c where handoff_state='HUMAN_ACTIVE' and exists(select 1 from public.contacts x where x.id=c.contact_id and x.org_id=c.org_id);
create table public.handoff_notifications (
 id uuid primary key default gen_random_uuid(),org_id uuid not null references public.organizations(id) on delete cascade,
 conversation_id uuid not null references public.conversations(id) on delete cascade,
 event_id uuid not null unique references public.handoff_events(id) on delete cascade,
 team_member_id uuid not null references public.team_members(id) on delete cascade,
 status text not null default 'queued' check(status in ('queued','sending','sent','failed','unknown','cancelled')),
 failure_code text,claim_token uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.handoff_notifications enable row level security;
revoke all on public.handoff_notifications from anon,authenticated;
grant all on public.handoff_notifications to service_role;

create function public.transition_handoff(p_org_id uuid,p_conversation_id uuid,p_action text,p_agent_id uuid default null,p_actor_id uuid default null,p_reason text default null,p_request_key text default null,p_timeout_seconds integer default 300,p_expected_revision integer default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare c public.conversations; previous text; target text; event_id uuid; begin
 select * into c from public.conversations where id=p_conversation_id and org_id=p_org_id for update;
 if not found or not exists(select 1 from public.contacts where id=c.contact_id and org_id=p_org_id) then raise exception using errcode='PT404',message='Conversation not found'; end if;
 if (c.device_id is not null and not exists(select 1 from public.devices where id=c.device_id and org_id=p_org_id)) or (c.assigned_to is not null and not exists(select 1 from public.team_members where id=c.assigned_to and org_id=p_org_id)) then raise exception using errcode='PT404',message='Conversation context not found';end if;
 if p_actor_id is not null and not exists(select 1 from public.users where id=p_actor_id and org_id=p_org_id and active and role<>'viewer') then raise exception using errcode='42501',message='Handoff permission required'; end if;
 previous:=c.handoff_state; target:=previous;
 if p_expected_revision is not null and c.handoff_revision<>p_expected_revision then return to_jsonb(c);end if;
 if p_request_key is not null and exists(select 1 from public.handoff_events where org_id=p_org_id and conversation_id=c.id and request_key=p_request_key) then return to_jsonb(c); end if;
 if p_action='request' then
  if previous<>'AI_ACTIVE' then return to_jsonb(c); end if;
  target:='HANDOFF_REQUESTED'; c.assigned_to:=null; c.handoff_reason:=left(coalesce(p_reason,'manual'),200); c.handoff_due_at:=null;
 elsif p_action='assign' then
  if previous not in ('HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT') then raise exception using errcode='PT409',message='Assignment requires a pending handoff'; end if;
  if not exists(select 1 from public.team_members where id=p_agent_id and org_id=p_org_id and active and available) then raise exception using errcode='PT404',message='Available team member not found'; end if;
  target:='ASSIGNED'; c.assigned_to:=p_agent_id; c.handoff_due_at:=now()+make_interval(secs=>greatest(10,least(p_timeout_seconds,86400)));
 elsif p_action='waiting' then
  if previous<>'ASSIGNED' or c.assigned_to is distinct from p_agent_id then return to_jsonb(c); end if;
  target:='WAITING_FOR_AGENT';
 elsif p_action='accept' then
  if previous='HUMAN_ACTIVE' then return to_jsonb(c); end if;
  if previous not in ('ASSIGNED','WAITING_FOR_AGENT') then raise exception using errcode='PT409',message='Assign an agent before accepting'; end if;
  if not exists(select 1 from public.team_members where id=c.assigned_to and org_id=p_org_id and active and available) then raise exception using errcode='PT409',message='Assigned agent is inactive or unavailable'; end if;
  -- Both sending and acceptance lock the conversation first. Never enter HUMAN_ACTIVE while a send may be in flight.
  if exists(select 1 from public.messages where conversation_id=c.id and org_id=p_org_id and sender_type='ai' and processing_status in ('sending','needs_review') and direction='outbound' and device_id is not null) then raise exception using errcode='PT409',message='Review outstanding AI transport before accepting'; end if;
  target:='HUMAN_ACTIVE'; c.handoff_due_at:=null;
 elsif p_action='resolve' then
  if previous='RESOLVED' then return to_jsonb(c); end if;
  if previous not in ('HUMAN_ACTIVE','HANDOFF_REQUESTED','ASSIGNED','WAITING_FOR_AGENT') then raise exception using errcode='PT409',message='No handoff to resolve'; end if;
  target:='RESOLVED';c.handoff_due_at:=null;
 elsif p_action='resume' then
  if previous='AI_ACTIVE' then return to_jsonb(c); end if;
  if previous<>'RESOLVED' then raise exception using errcode='PT409',message='Resolve the handoff before resuming AI'; end if;
  target:='AI_ACTIVE';c.assigned_to:=null;c.handoff_due_at:=null;c.handoff_reason:=null;
 elsif p_action='timeout' then
  if previous not in ('ASSIGNED','WAITING_FOR_AGENT') or c.handoff_due_at is null or c.handoff_due_at>now() then return to_jsonb(c); end if;
  target:='HANDOFF_REQUESTED';c.assigned_to:=null;c.handoff_due_at:=null;
 else raise exception using errcode='PT400',message='Unknown handoff action'; end if;
 update public.conversations set handoff_state=target,handoff_revision=handoff_revision+1,handoff_due_at=c.handoff_due_at,
 handoff_reason=c.handoff_reason,assigned_to=c.assigned_to,handled_by=case when target='AI_ACTIVE' then 'ai' else 'human' end,updated_at=now()
 where id=c.id and org_id=p_org_id returning * into c;
 insert into public.handoff_events(org_id,conversation_id,contact_id,triggered_by,trigger_value,assigned_to,status,from_state,to_state,event_type,actor_id,request_key,accepted_at,resolved_at)
 values(p_org_id,c.id,c.contact_id,case when p_action='request' and p_actor_id is null then 'keyword' else 'manual' end,c.handoff_reason,c.assigned_to,
 case when target='HUMAN_ACTIVE' then 'accepted' when target='RESOLVED' then 'resolved' else 'pending' end,previous,target,p_action,p_actor_id,p_request_key,
 case when target='HUMAN_ACTIVE' then now() end,case when target='RESOLVED' then now() end) returning id into event_id;
 if p_action in ('assign','timeout','resolve','resume','accept') then
  update public.handoff_notifications set status='cancelled',updated_at=now() where org_id=p_org_id and conversation_id=c.id and status='queued';
 end if;
 if p_action='assign' then insert into public.handoff_notifications(org_id,conversation_id,event_id,team_member_id) values(p_org_id,c.id,event_id,c.assigned_to);end if;
 return to_jsonb(c);
end $$;

-- Fence all existing AI persistence paths, including compatibility APIs.
create function public.guard_handoff_message() returns trigger language plpgsql set search_path=public as $$
declare c public.conversations; begin
 if new.direction='outbound' and new.sender_type='ai' then
  select * into c from public.conversations where id=new.conversation_id and org_id=new.org_id for update;
  if not found then raise exception using errcode='PT404',message='Conversation not found';end if;
  if c.handoff_state in ('HUMAN_ACTIVE','RESOLVED') or (c.handled_by='human' and c.handoff_state='AI_ACTIVE') then raise exception using errcode='PT409',message='AI blocked by human handoff';end if;
 end if; return new;
end $$;
create trigger handoff_ai_message_guard before insert on public.messages for each row execute function public.guard_handoff_message();

create or replace function public.claim_whatsapp_send(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; c public.conversations; begin
 select v.* into c from public.conversations v join public.messages x on x.conversation_id=v.id and x.org_id=v.org_id where x.id=p_message_id and x.org_id=p_org_id and x.device_id=p_device_id for update of v;
 if not found then return null;end if;
 if c.handoff_state in ('HUMAN_ACTIVE','RESOLVED') or (c.handled_by='human' and c.handoff_state='AI_ACTIVE') then
  update public.messages set processing_status='ignored',failure_code='HUMAN_HANDOFF',processed_at=now() where id=p_message_id and org_id=p_org_id and device_id=p_device_id and processing_status='prepared';return null;
 end if;
 update public.messages set processing_status='sending',claim_token=p_token where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='outbound' and processing_status='prepared' returning * into m;
 return case when found then to_jsonb(m) else null end;
end $$;

create function public.claim_handoff_notification(p_org_id uuid,p_id uuid,p_token uuid) returns jsonb language plpgsql security invoker set search_path=public as $$
declare n public.handoff_notifications; c public.conversations; begin
 select v.* into c from public.conversations v join public.handoff_notifications x on x.conversation_id=v.id and x.org_id=v.org_id where x.id=p_id and x.org_id=p_org_id for update of v;
 if not found then return null;end if;
 update public.handoff_notifications n1 set status='sending',claim_token=p_token,updated_at=now() where n1.id=p_id and n1.org_id=p_org_id and n1.status='queued' and n1.team_member_id=c.assigned_to and c.handoff_state in ('ASSIGNED','WAITING_FOR_AGENT')
 and exists(select 1 from public.team_members where id=n1.team_member_id and org_id=p_org_id and active and available) returning * into n;
 return case when found then to_jsonb(n) else null end;
end $$;
revoke all on function public.transition_handoff(uuid,uuid,text,uuid,uuid,text,text,integer,integer),public.guard_handoff_message(),public.claim_handoff_notification(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.transition_handoff(uuid,uuid,text,uuid,uuid,text,text,integer,integer),public.guard_handoff_message(),public.claim_handoff_notification(uuid,uuid,uuid) to service_role;

create function public.validate_handoff_notification() returns trigger language plpgsql set search_path=public as $$
begin
 if not exists(select 1 from public.conversations where id=new.conversation_id and org_id=new.org_id)
 or not exists(select 1 from public.team_members where id=new.team_member_id and org_id=new.org_id)
 or not exists(select 1 from public.handoff_events where id=new.event_id and org_id=new.org_id and conversation_id=new.conversation_id) then raise exception using errcode='PT404',message='Notification parent not found';end if;
 return new;
end $$;
create trigger handoff_notification_tenant before insert or update on public.handoff_notifications for each row execute function public.validate_handoff_notification();
revoke all on function public.validate_handoff_notification() from public,anon,authenticated;
grant execute on function public.validate_handoff_notification() to service_role;
