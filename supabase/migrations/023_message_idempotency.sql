-- Additive transport cutover. Historical messages keep NULL device/status values.
-- No historical IDs are invented and no duplicate history is deleted.
alter table public.messages add column device_id uuid;
alter table public.messages add column processing_status text check
 (processing_status in ('received','processing','prepared','sending','completed','ignored','needs_review'));
alter table public.messages add column processed_at timestamptz;
alter table public.messages add column failure_code text;
alter table public.messages add column claim_token uuid;
alter table public.messages add column reply_to_message_id uuid;
alter table public.messages add constraint messages_transport_owner unique(org_id,id);
-- Device identity is retained after device deletion. Ownership is checked under a
-- key-share lock at insertion, rather than deleting/nulling transport history.
alter table public.messages add constraint messages_transport_reply foreign key(org_id,reply_to_message_id) references public.messages(org_id,id);
create unique index messages_transport_identity on public.messages(org_id,device_id,wa_message_id,direction)
 where device_id is not null and wa_message_id is not null;
create unique index messages_one_response on public.messages(reply_to_message_id) where reply_to_message_id is not null;
create index messages_transport_pending on public.messages(org_id,device_id,processing_status,created_at)
 where processing_status in ('prepared','processing','sending');

-- Retain admission even if an authorized user later deletes a contact/conversation.
create table public.message_receipts (
 org_id uuid not null references public.organizations(id) on delete cascade,
 device_id uuid not null,
 wa_message_id text not null,
 logical_message_id uuid not null,
 received_at timestamptz not null default now(),
 primary key(org_id,device_id,wa_message_id)
);
alter table public.message_receipts enable row level security;
revoke all on public.message_receipts from public,anon,authenticated;
grant all on public.message_receipts to service_role;
create function public.validate_message_receipt() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform 1 from public.devices where id=new.device_id and org_id=new.org_id for key share;
 if not found then raise exception using errcode='23503',message='Receipt device ownership mismatch'; end if;
 return new;
end $$;
create trigger message_receipts_device_validation before insert or update on public.message_receipts for each row execute function public.validate_message_receipt();
-- Only explicit, tenant-valid historical conversation/device links can seed receipts.
-- Ambiguous history is preserved; a receipt suppresses re-execution without choosing a reply.
insert into public.message_receipts(org_id,device_id,wa_message_id,logical_message_id,received_at)
 select m.org_id,c.device_id,m.wa_message_id,(array_agg(m.id order by m.created_at,m.id))[1],min(m.created_at)
 from public.messages m join public.conversations c on c.id=m.conversation_id and c.org_id=m.org_id
 join public.devices d on d.id=c.device_id and d.org_id=m.org_id
 where m.direction='inbound' and nullif(btrim(m.wa_message_id),'') is not null
 group by m.org_id,c.device_id,m.wa_message_id;

do $$ declare duplicates bigint; begin
 select count(*) into duplicates from (select org_id,wa_message_id,direction from public.messages
 where wa_message_id is not null group by org_id,wa_message_id,direction having count(*)>1) d;
 raise notice 'Message identity audit: % ambiguous historical identities retained without device inference',duplicates;
end $$;

create function public.validate_transport_message() returns trigger language plpgsql security invoker set search_path=public as $$
declare parent public.messages; begin
 if tg_op='DELETE' then
  if old.processing_status is not null and current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='Transport rows are server-managed'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and old.processing_status is not null and (new.org_id,new.device_id,new.wa_message_id,new.direction,new.conversation_id,new.reply_to_message_id) is distinct from (old.org_id,old.device_id,old.wa_message_id,old.direction,old.conversation_id,old.reply_to_message_id) then raise exception 'Transport identity is immutable'; end if;
 if tg_op='UPDATE' and old.processing_status is not null and current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='Transport rows are server-managed'; end if;
 if new.processing_status is null and new.reply_to_message_id is null and new.device_id is null then return new; end if;
 if current_user not in ('service_role','postgres','supabase_admin') then raise exception using errcode='42501',message='Transport rows are server-managed'; end if;
 if new.device_id is null or nullif(btrim(new.wa_message_id),'') is null then raise exception 'Transport identity required'; end if;
 if tg_op='INSERT' or old.device_id is distinct from new.device_id then
  perform 1 from public.devices where id=new.device_id and org_id=new.org_id for key share;
  if not found then raise exception using errcode='23503',message='Message device ownership mismatch'; end if;
 end if;
 perform 1 from public.conversations where id=new.conversation_id and org_id=new.org_id;
 if not found then raise exception using errcode='23503',message='Conversation ownership mismatch'; end if;
 if new.reply_to_message_id is not null then
  select * into parent from public.messages where id=new.reply_to_message_id and org_id=new.org_id;
  if not found or parent.direction<>'inbound' or new.direction<>'outbound' or parent.device_id<>new.device_id or parent.conversation_id<>new.conversation_id then
   raise exception using errcode='23503',message='Inbound response ownership mismatch';
  end if;
 end if;
 return new;
end $$;
create trigger messages_transport_validation before insert or update or delete on public.messages for each row execute function public.validate_transport_message();

-- Persistence and duplicate admission share one transaction. Duplicate payloads never update a contact.
create function public.receive_whatsapp_message(p_org_id uuid,p_device_id uuid,p_wa_message_id text,p_jid text,p_phone text,p_name text,p_content text,p_type text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; c public.contacts; v public.conversations; admitted uuid; begin
 if nullif(btrim(p_wa_message_id),'') is null or length(p_wa_message_id)>200 or nullif(btrim(p_jid),'') is null or nullif(btrim(p_phone),'') is null then raise exception 'Invalid inbound identity'; end if;
 perform 1 from public.devices where id=p_device_id and org_id=p_org_id for key share;
 if not found then raise exception using errcode='PT404',message='Device not found'; end if;
 -- Serialize the same sender across replicas through persistence, not across external calls.
 perform pg_advisory_xact_lock(hashtextextended(p_org_id::text||':'||p_phone,0));
 insert into public.message_receipts(org_id,device_id,wa_message_id,logical_message_id)
 values(p_org_id,p_device_id,p_wa_message_id,gen_random_uuid()) on conflict do nothing returning logical_message_id into admitted;
 if not found then
  select * into m from public.messages where org_id=p_org_id and device_id=p_device_id and wa_message_id=p_wa_message_id and direction='inbound';
  if found then return to_jsonb(m); end if;
  return jsonb_build_object('id',(select logical_message_id from public.message_receipts where org_id=p_org_id and device_id=p_device_id and wa_message_id=p_wa_message_id),'org_id',p_org_id,'device_id',p_device_id,'processing_status','ignored');
 end if;
 insert into public.contacts(org_id,phone,name,last_message_at) values(p_org_id,p_phone,p_name,now())
 on conflict(org_id,phone) do update set name=coalesce(excluded.name,contacts.name),last_message_at=excluded.last_message_at returning * into c;
 select * into v from public.conversations where org_id=p_org_id and contact_id=c.id for update;
 if not found then
  insert into public.conversations(org_id,contact_id,device_id,status,last_message_at) values(p_org_id,c.id,p_device_id,'active',now()) returning * into v;
 elsif v.status<>'active' then
  update public.conversations set status='active',device_id=p_device_id,last_message_at=now() where id=v.id and org_id=p_org_id returning * into v;
 end if;
 insert into public.messages(id,org_id,conversation_id,device_id,direction,sender_type,content,message_type,wa_message_id,processing_status,metadata)
 values(admitted,p_org_id,v.id,p_device_id,'inbound','contact',p_content,p_type,p_wa_message_id,'received',jsonb_build_object('replyJid',p_jid)) returning * into m;
 update public.conversations set last_message_at=now() where id=v.id and org_id=p_org_id;
 return to_jsonb(m);
end $$;

create function public.claim_whatsapp_execution(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; begin
 update public.messages set processing_status='processing',claim_token=p_token
 where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' and processing_status='received' returning * into m;
 return case when found then to_jsonb(m) else null end;
end $$;

-- Exactly one saved response, committed before any network send. Retries reuse it.
create function public.prepare_whatsapp_response(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid,p_text text,p_outbound_wa_id text,p_metadata jsonb,p_match_metadata jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; o public.messages; begin
 select * into m from public.messages where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' for update;
 if not found then raise exception using errcode='PT404',message='Inbound not found'; end if;
 select * into o from public.messages where org_id=p_org_id and reply_to_message_id=m.id;
 if found then return to_jsonb(o); end if;
 if m.processing_status<>'processing' or m.claim_token is distinct from p_token then raise exception using errcode='PT409',message='Execution claim lost'; end if;
 if nullif(btrim(p_text),'') is null then raise exception 'Response text required'; end if;
 insert into public.messages(org_id,conversation_id,device_id,direction,sender_type,sender_name,content,message_type,wa_message_id,status,processing_status,reply_to_message_id,metadata)
 values(p_org_id,m.conversation_id,p_device_id,'outbound','ai','Aya',p_text,'text',p_outbound_wa_id,'failed','prepared',m.id,coalesce(p_metadata,'{}')||jsonb_build_object('transport','baileys','replyJid',m.metadata->>'replyJid')) returning * into o;
 update public.contacts c set contact_memory=coalesce(c.contact_memory,'{}')||coalesce(p_match_metadata,'{}'),updated_at=now()
 from public.conversations v where v.id=m.conversation_id and v.org_id=p_org_id and c.id=v.contact_id and c.org_id=p_org_id;
 update public.messages set processing_status='prepared',processed_at=now() where id=m.id and org_id=p_org_id;
 return to_jsonb(o);
end $$;

create function public.claim_whatsapp_send(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; begin
 update public.messages set processing_status='sending',claim_token=p_token
 where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='outbound' and processing_status='prepared' returning * into m;
 return case when found then to_jsonb(m) else null end;
end $$;

create function public.finish_whatsapp_send(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid,p_success boolean,p_failure_code text)
returns boolean language plpgsql security invoker set search_path=public as $$
declare m public.messages; begin
 update public.messages set processing_status=case when p_success then 'completed' else 'needs_review' end,
 status=case when p_success then 'sent' else 'failed' end,processed_at=now(),failure_code=case when p_success then null else p_failure_code end
 where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='outbound' and processing_status='sending' and claim_token=p_token returning * into m;
 if not found then return false; end if;
 update public.messages set processing_status=m.processing_status,processed_at=now(),failure_code=m.failure_code where id=m.reply_to_message_id and org_id=p_org_id and device_id=p_device_id;
 update public.conversations set last_message_at=now() where id=m.conversation_id and org_id=p_org_id;
 return true;
end $$;

create function public.stop_whatsapp_execution(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid,p_ignored boolean,p_failure_code text)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
 update public.messages set processing_status=case when p_ignored then 'ignored' else 'needs_review' end,processed_at=now(),failure_code=p_failure_code
 where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' and processing_status='processing' and claim_token=p_token;
 return found;
end $$;

-- All RPCs are backend-only, including trigger execution. Existing message RLS stays intact.
revoke all on function public.validate_transport_message() from public,anon,authenticated;
revoke all on function public.validate_message_receipt() from public,anon,authenticated;
revoke all on function public.receive_whatsapp_message(uuid,uuid,text,text,text,text,text,text) from public,anon,authenticated;
revoke all on function public.claim_whatsapp_execution(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.prepare_whatsapp_response(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.claim_whatsapp_send(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.finish_whatsapp_send(uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function public.stop_whatsapp_execution(uuid,uuid,uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.validate_transport_message(),public.validate_message_receipt(),public.receive_whatsapp_message(uuid,uuid,text,text,text,text,text,text),public.claim_whatsapp_execution(uuid,uuid,uuid,uuid),public.prepare_whatsapp_response(uuid,uuid,uuid,uuid,text,text,jsonb,jsonb),public.claim_whatsapp_send(uuid,uuid,uuid,uuid),public.finish_whatsapp_send(uuid,uuid,uuid,uuid,boolean,text),public.stop_whatsapp_execution(uuid,uuid,uuid,uuid,boolean,text) to service_role;
