-- Reviewed rollback companion to the previous application deployment.
-- Retains dialogue/order columns, saved data and all historical migrations.
BEGIN;
create or replace function public.claim_whatsapp_execution(p_org_id uuid,p_device_id uuid,p_message_id uuid,p_token uuid)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare m public.messages; begin
 update public.messages set processing_status='processing',claim_token=p_token
 where id=p_message_id and org_id=p_org_id and device_id=p_device_id and direction='inbound' and processing_status='received' returning * into m;
 return case when found then to_jsonb(m) else null end;
end $$;

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
NOTIFY pgrst,'reload schema';
COMMIT;
