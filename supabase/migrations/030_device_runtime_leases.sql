-- Phase 10: database-clock ownership, fenced session/state writes and durable relay.
BEGIN;
ALTER TABLE public.devices ADD CONSTRAINT devices_runtime_tenant_identity UNIQUE(id,org_id);
CREATE TABLE public.device_runtime_leases (
 device_id uuid PRIMARY KEY REFERENCES public.devices(id) ON DELETE CASCADE,
 org_id uuid NOT NULL REFERENCES public.organizations(id), owner_id uuid,
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 lease_until timestamptz NOT NULL, heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp()
 ,FOREIGN KEY(device_id,org_id) REFERENCES public.devices(id,org_id) ON DELETE CASCADE
);
CREATE INDEX device_runtime_lease_org ON public.device_runtime_leases(org_id,lease_until);
ALTER TABLE public.device_runtime_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_runtime_leases FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.device_runtime_leases TO service_role;

CREATE FUNCTION public.device_runtime_lease(p_org uuid,p_device uuid,p_owner uuid,p_generation bigint,p_action text,p_ttl integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE lease device_runtime_leases; at_time timestamptz;
BEGIN
 IF p_action NOT IN ('acquire','renew','check','release','revoke') OR p_ttl NOT BETWEEN 1 AND 120 THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid lease operation'; END IF;
 -- Serialize acquisition and control against the tenant-owned device, including first acquisition.
 PERFORM 1 FROM devices WHERE id=p_device AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Device not found'; END IF;
 SELECT * INTO lease FROM device_runtime_leases WHERE device_id=p_device AND org_id=p_org FOR UPDATE;
 at_time:=clock_timestamp();
 IF p_action='acquire' THEN
  IF p_owner IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Owner required'; END IF;
  IF lease.owner_id IS NOT NULL AND lease.lease_until>at_time AND lease.owner_id<>p_owner THEN RETURN NULL; END IF;
  IF lease.device_id IS NULL THEN
   INSERT INTO device_runtime_leases(device_id,org_id,owner_id,generation,lease_until) VALUES(p_device,p_org,p_owner,1,at_time+make_interval(secs=>p_ttl)) RETURNING * INTO lease;
  ELSE
   UPDATE device_runtime_leases SET owner_id=p_owner,generation=CASE WHEN owner_id=p_owner AND lease_until>at_time THEN generation ELSE generation+1 END,lease_until=at_time+make_interval(secs=>p_ttl),heartbeat_at=at_time WHERE device_id=p_device AND org_id=p_org RETURNING * INTO lease;
  END IF;
 ELSIF p_action='revoke' THEN
  IF lease.device_id IS NOT NULL THEN UPDATE device_runtime_leases SET owner_id=NULL,generation=generation+1,lease_until=at_time,heartbeat_at=at_time WHERE device_id=p_device AND org_id=p_org RETURNING * INTO lease; END IF;
  UPDATE devices SET status='disconnected',qr_code=NULL,updated_at=at_time WHERE id=p_device AND org_id=p_org;
 ELSE
  IF lease.owner_id IS DISTINCT FROM p_owner OR p_owner IS NULL OR lease.generation IS DISTINCT FROM p_generation OR lease.lease_until<=at_time THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Device lease lost'; END IF;
  IF p_action='renew' THEN UPDATE device_runtime_leases SET lease_until=at_time+make_interval(secs=>p_ttl),heartbeat_at=at_time WHERE device_id=p_device AND org_id=p_org RETURNING * INTO lease;
  ELSIF p_action='release' THEN UPDATE device_runtime_leases SET owner_id=NULL,generation=generation+1,lease_until=at_time,heartbeat_at=at_time WHERE device_id=p_device AND org_id=p_org RETURNING * INTO lease; END IF;
 END IF;
 RETURN to_jsonb(lease);
END $$;

CREATE FUNCTION public.fenced_device_state(p_org uuid,p_device uuid,p_owner uuid,p_generation bigint,p_status text,p_qr text DEFAULT NULL,p_phone text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 PERFORM device_runtime_lease(p_org,p_device,p_owner,p_generation,'check');
 IF p_status NOT IN ('connected','connecting','disconnected') THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid device state'; END IF;
 UPDATE devices SET status=p_status,qr_code=p_qr,phone=COALESCE(p_phone,phone),last_seen=CASE WHEN p_status='connected' THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp() WHERE id=p_device AND org_id=p_org;
END $$;

CREATE FUNCTION public.fenced_session_write(p_org uuid,p_device uuid,p_owner uuid,p_generation bigint,p_action text,p_key_type text DEFAULT NULL,p_key_id text DEFAULT NULL,p_data text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
DECLARE lease device_runtime_leases;
BEGIN
 PERFORM 1 FROM devices WHERE id=p_device AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Device not found'; END IF;
 IF p_owner IS NOT NULL THEN PERFORM device_runtime_lease(p_org,p_device,p_owner,p_generation,'check');
 ELSE
  SELECT * INTO lease FROM device_runtime_leases WHERE device_id=p_device AND org_id=p_org FOR UPDATE;
  IF lease.owner_id IS NOT NULL AND lease.lease_until>clock_timestamp() THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Active owner required'; END IF;
 END IF;
 IF p_action='write' THEN
  IF p_key_type IS NULL OR p_key_id IS NULL OR p_data IS NULL THEN RAISE SQLSTATE 'PT400' USING MESSAGE='Session key required'; END IF;
  INSERT INTO baileys_sessions(device_id,org_id,key_type,key_id,data) VALUES(p_device,p_org,p_key_type,p_key_id,p_data) ON CONFLICT(device_id,key_type,key_id) DO UPDATE SET data=excluded.data,updated_at=clock_timestamp() WHERE baileys_sessions.org_id=p_org;
 ELSIF p_action='remove' THEN DELETE FROM baileys_sessions WHERE device_id=p_device AND org_id=p_org AND key_type=p_key_type AND key_id=p_key_id;
 ELSIF p_action='clear' THEN DELETE FROM baileys_sessions WHERE device_id=p_device AND org_id=p_org;
 ELSE RAISE SQLSTATE 'PT400' USING MESSAGE='Invalid session operation'; END IF;
END $$;

CREATE TABLE public.device_outbound_jobs (
 id uuid PRIMARY KEY,org_id uuid NOT NULL REFERENCES organizations(id),device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
 wa_message_id text NOT NULL CHECK(length(wa_message_id) BETWEEN 1 AND 100),jid text NOT NULL CHECK(length(jid) BETWEEN 1 AND 100),
 content text NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 65536),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','sent','review_required','cancelled')),
 owner_id uuid,generation bigint,receipt_id text,failure_code text,deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 seconds',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(device_id,wa_message_id), FOREIGN KEY(device_id,org_id) REFERENCES public.devices(id,org_id) ON DELETE CASCADE
);
CREATE INDEX device_outbound_pending ON public.device_outbound_jobs(org_id,device_id,created_at) WHERE state='queued';
ALTER TABLE public.device_outbound_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.device_outbound_jobs FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE ON public.device_outbound_jobs TO service_role;
CREATE FUNCTION public.enqueue_device_send(p_org uuid,p_device uuid,p_id uuid,p_wa_id text,p_jid text,p_text text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result device_outbound_jobs;
BEGIN
 PERFORM 1 FROM devices WHERE id=p_device AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'PT404' USING MESSAGE='Device not found'; END IF;
 INSERT INTO device_outbound_jobs(id,org_id,device_id,wa_message_id,jid,content) VALUES(p_id,p_org,p_device,p_wa_id,p_jid,p_text) ON CONFLICT(device_id,wa_message_id) DO NOTHING;
 SELECT * INTO result FROM device_outbound_jobs WHERE org_id=p_org AND device_id=p_device AND wa_message_id=p_wa_id;
 IF result.jid<>p_jid OR result.content<>p_text THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Send identity conflicts'; END IF;
 RETURN to_jsonb(result);
END $$;
CREATE FUNCTION public.claim_device_send(p_org uuid,p_device uuid,p_id uuid,p_owner uuid,p_generation bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result device_outbound_jobs;
BEGIN
 PERFORM device_runtime_lease(p_org,p_device,p_owner,p_generation,'check');
 UPDATE device_outbound_jobs SET state='cancelled',failure_code='SEND_DEADLINE_EXPIRED',updated_at=clock_timestamp() WHERE id=p_id AND org_id=p_org AND device_id=p_device AND state='queued' AND deadline<=clock_timestamp();
 UPDATE device_outbound_jobs SET state='sending',owner_id=p_owner,generation=p_generation,updated_at=clock_timestamp() WHERE id=p_id AND org_id=p_org AND device_id=p_device AND state='queued' AND deadline>clock_timestamp() RETURNING * INTO result;
 RETURN CASE WHEN result.id IS NULL THEN NULL ELSE to_jsonb(result) END;
END $$;
CREATE FUNCTION public.finish_device_send(p_org uuid,p_device uuid,p_id uuid,p_owner uuid,p_generation bigint,p_receipt text,p_success boolean)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 -- Completion may record an old in-flight acknowledgement; it cannot admit another send.
 UPDATE device_outbound_jobs SET state=CASE WHEN p_success AND p_receipt=wa_message_id THEN 'sent' ELSE 'review_required' END,receipt_id=p_receipt,failure_code=CASE WHEN p_success AND p_receipt=wa_message_id THEN NULL ELSE 'SEND_OUTCOME_UNKNOWN' END,updated_at=clock_timestamp() WHERE id=p_id AND org_id=p_org AND device_id=p_device AND state='sending' AND owner_id=p_owner AND generation=p_generation;
END $$;
CREATE FUNCTION public.cancel_device_send(p_org uuid,p_device uuid,p_id uuid)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 UPDATE device_outbound_jobs SET state='cancelled',failure_code='SEND_DEADLINE_EXPIRED',updated_at=clock_timestamp() WHERE id=p_id AND org_id=p_org AND device_id=p_device AND state='queued';
END $$;
REVOKE ALL ON FUNCTION public.device_runtime_lease(uuid,uuid,uuid,bigint,text,integer),public.fenced_device_state(uuid,uuid,uuid,bigint,text,text,text),public.fenced_session_write(uuid,uuid,uuid,bigint,text,text,text,text),public.enqueue_device_send(uuid,uuid,uuid,text,text,text),public.claim_device_send(uuid,uuid,uuid,uuid,bigint),public.finish_device_send(uuid,uuid,uuid,uuid,bigint,text,boolean),public.cancel_device_send(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.device_runtime_lease(uuid,uuid,uuid,bigint,text,integer),public.fenced_device_state(uuid,uuid,uuid,bigint,text,text,text),public.fenced_session_write(uuid,uuid,uuid,bigint,text,text,text,text),public.enqueue_device_send(uuid,uuid,uuid,text,text,text),public.claim_device_send(uuid,uuid,uuid,uuid,bigint),public.finish_device_send(uuid,uuid,uuid,uuid,bigint,text,boolean),public.cancel_device_send(uuid,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
