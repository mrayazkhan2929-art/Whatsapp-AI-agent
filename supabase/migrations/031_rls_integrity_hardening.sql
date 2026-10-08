BEGIN;

-- Browser claims never choose a tenant. Match the application membership policy.
CREATE OR REPLACE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, auth AS $$
DECLARE identity uuid := auth.uid(); member public.users%ROWTYPE; confirmed_email text; matches integer;
BEGIN
  IF identity IS NULL THEN RETURN NULL; END IF;
  SELECT * INTO member FROM public.users WHERE id = identity;
  IF NOT FOUND THEN
    SELECT email INTO confirmed_email FROM auth.users WHERE id = identity AND email_confirmed_at IS NOT NULL;
    IF confirmed_email IS NULL THEN RETURN NULL; END IF;
    SELECT count(*) INTO matches FROM public.users WHERE email = confirmed_email;
    IF matches <> 1 THEN RETURN NULL; END IF;
    SELECT * INTO member FROM public.users WHERE email = confirmed_email;
  END IF;
  IF member.active IS DISTINCT FROM true OR member.role NOT IN ('owner','admin','operator','member','viewer') THEN RETURN NULL; END IF;
  RETURN (SELECT id FROM public.organizations WHERE id = member.org_id);
END $$;

-- Retain authenticated Realtime reads, hiding malformed historical parent links.
CREATE FUNCTION public.visible_inbox_parent(p_conversation uuid, p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT p_org = public.current_org_id() AND EXISTS (
    SELECT 1 FROM public.conversations c JOIN public.contacts t ON t.id=c.contact_id AND t.org_id=c.org_id
    WHERE c.id=p_conversation AND c.org_id=p_org
      AND (c.device_id IS NULL OR EXISTS(SELECT 1 FROM public.devices d WHERE d.id=c.device_id AND d.org_id=c.org_id))
      AND (c.assigned_to IS NULL OR EXISTS(SELECT 1 FROM public.team_members m WHERE m.id=c.assigned_to AND m.org_id=c.org_id))
  );
$$;

-- All writes and privileged reads go through the authorized application APIs.
-- No data is rewritten; private internal tables keep their existing service grants.
DO $$ DECLARE item record; policy record;
BEGIN
  FOR item IN SELECT c.oid,c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m')
      AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=c.oid AND d.deptype='e') LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',item.relname);
    IF item.relkind IN ('r','p') THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',item.relname);
      FOR policy IN SELECT polname FROM pg_policy WHERE polrelid=item.oid LOOP
        EXECUTE format('DROP POLICY %I ON public.%I',policy.polname,item.relname);
      END LOOP;
    END IF;
  END LOOP;
  -- Legacy RPCs must not offer an alternate path around application authorization.
  FOR item IN SELECT p.oid::regprocedure signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.objid=p.oid AND d.deptype='e') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',item.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',item.signature);
  END LOOP;
END $$;
GRANT SELECT ON public.conversations,public.messages TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id(),public.visible_inbox_parent(uuid,uuid) TO authenticated;
CREATE POLICY authorized_inbox_read ON public.conversations FOR SELECT TO authenticated
  USING (org_id=public.current_org_id() AND public.visible_inbox_parent(id,org_id));
-- Check device ownership without granting browser access to private device columns.
CREATE FUNCTION public.visible_message_device(p_device uuid,p_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
 SELECT p_org=public.current_org_id() AND EXISTS(SELECT 1 FROM public.devices WHERE id=p_device AND org_id=p_org);
$$;
REVOKE ALL ON FUNCTION public.visible_message_device(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.visible_message_device(uuid,uuid) TO authenticated,service_role;
CREATE POLICY authorized_message_read ON public.messages FOR SELECT TO authenticated USING (
 org_id=public.current_org_id() AND public.visible_inbox_parent(conversation_id,org_id)
 AND (device_id IS NULL OR public.visible_message_device(device_id,org_id)));

-- Check every declared single-column tenant-to-tenant FK on new/changed links.
-- Existing malformed rows are retained for reconciliation and cannot be exposed by Realtime.
CREATE FUNCTION public.guard_tenant_links() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE index integer := 0; parent_org uuid; row_data jsonb := to_jsonb(NEW); prior jsonb;
BEGIN
  IF TG_OP='UPDATE' THEN
    prior := to_jsonb(OLD);
    IF NEW.org_id IS DISTINCT FROM OLD.org_id THEN RAISE EXCEPTION 'Tenant ownership is immutable' USING ERRCODE='PT403'; END IF;
  END IF;
  WHILE index < TG_NARGS LOOP
    IF row_data->>TG_ARGV[index] IS NOT NULL AND (TG_OP='INSERT' OR row_data->TG_ARGV[index] IS DISTINCT FROM prior->TG_ARGV[index]) THEN
      EXECUTE format('SELECT org_id FROM public.%I WHERE %I=$1::uuid',TG_ARGV[index+1],TG_ARGV[index+2])
        INTO parent_org USING row_data->>TG_ARGV[index];
      IF parent_org IS DISTINCT FROM NEW.org_id THEN RAISE EXCEPTION 'Related resource not found' USING ERRCODE='PT404'; END IF;
    END IF;
    index := index+3;
  END LOOP;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_tenant_links() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_tenant_links() TO service_role;
DO $$ DECLARE item record;
BEGIN
 FOR item IN
 SELECT child.relname, string_agg(format('%L,%L,%L',ca.attname,parent.relname,pa.attname),',' ORDER BY f.conname) arguments
 FROM pg_constraint f JOIN pg_class child ON child.oid=f.conrelid JOIN pg_class parent ON parent.oid=f.confrelid
 JOIN pg_namespace n ON n.oid=child.relnamespace
 JOIN pg_attribute ca ON ca.attrelid=f.conrelid AND ca.attnum=f.conkey[1]
 JOIN pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=f.confkey[1]
 WHERE f.contype='f' AND n.nspname='public' AND cardinality(f.conkey)=1 AND pa.atttypid='uuid'::regtype
 AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=child.oid AND attname='org_id' AND NOT attisdropped)
 AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=parent.oid AND attname='org_id' AND NOT attisdropped)
 GROUP BY child.relname LOOP
 EXECUTE format('CREATE TRIGGER phase11_guard_tenant_links BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_links(%s)',item.relname,item.arguments);
 END LOOP;
END $$;

-- Tables with no tenant parent FKs still require immutable organization ownership.
DO $$ DECLARE item record;
BEGIN
 FOR item IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind='r'
 AND EXISTS(SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attname='org_id' AND NOT a.attisdropped)
 AND NOT EXISTS(SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND t.tgname='phase11_guard_tenant_links') LOOP
   EXECUTE format('CREATE TRIGGER phase11_guard_tenant_links BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_tenant_links()',item.relname);
 END LOOP;
END $$;

-- Only the server may provision, after validating the supplied identity with Auth.
-- Lock by email and ID so retries cannot create duplicate organizations.
CREATE FUNCTION public.onboard_organization(p_user uuid,p_name text,p_member_name text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,auth AS $$
DECLARE identity_email text; tenant uuid := gen_random_uuid();
BEGIN
 SELECT email INTO identity_email FROM auth.users WHERE id=p_user AND email_confirmed_at IS NOT NULL;
 IF identity_email IS NULL THEN RAISE EXCEPTION 'Confirm your email before creating a workspace' USING ERRCODE='PT403'; END IF;
 IF length(btrim(p_name)) NOT BETWEEN 2 AND 100 OR length(btrim(p_member_name)) NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Company and member names are required' USING ERRCODE='PT400'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(identity_email,11));
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,12));
 IF EXISTS(SELECT 1 FROM public.users WHERE id=p_user OR email=identity_email) THEN
   RAISE EXCEPTION 'Existing membership must be resolved by your administrator' USING ERRCODE='PT409'; END IF;
 INSERT INTO public.organizations(id,name,slug) VALUES(tenant,btrim(p_name),'workspace-'||tenant::text);
 INSERT INTO public.users(id,org_id,email,name,role,password_hash,active)
   VALUES(p_user,tenant,identity_email,btrim(p_member_name),'owner','supabase-auth',true);
 RETURN tenant;
END $$;
REVOKE ALL ON FUNCTION public.onboard_organization(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_organization(uuid,text,text) TO service_role;
COMMENT ON FUNCTION public.onboard_organization(uuid,text,text) IS 'Explicit new-workspace provisioning; never invoked by membership resolution.';
NOTIFY pgrst,'reload schema';
COMMIT;
