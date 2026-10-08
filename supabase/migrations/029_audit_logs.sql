-- Phase 9: privileged application action/access records, without request bodies.
BEGIN;
CREATE TABLE public.audit_logs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL REFERENCES organizations(id),actor_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action)<=120),resource_type text NOT NULL CHECK(length(resource_type)<=80),
 resource_id uuid, outcome text NOT NULL CHECK(outcome IN ('succeeded','denied','failed')),
 details jsonb NOT NULL CHECK(jsonb_typeof(details)='object' AND octet_length(details::text)<=5000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_history ON public.audit_logs(org_id,created_at DESC,id DESC);
CREATE FUNCTION public.guard_audit_record() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE SQLSTATE '42501' USING MESSAGE='Audit history is immutable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.actor_id AND org_id=NEW.org_id AND active) THEN RAISE SQLSTATE '42501' USING MESSAGE='Active tenant actor required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER audit_record_guard BEFORE INSERT OR UPDATE OR DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.guard_audit_record();
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.audit_logs FROM service_role;
GRANT SELECT,INSERT ON public.audit_logs TO service_role;
REVOKE ALL ON FUNCTION public.guard_audit_record() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
