BEGIN;
ALTER TABLE public.devices ADD CONSTRAINT devices_org_identity UNIQUE(org_id,id);
ALTER TABLE public.knowledge_bases ADD CONSTRAINT knowledge_bases_org_identity UNIQUE(org_id,id);
CREATE TABLE public.agent_version_tools (
 org_id uuid NOT NULL,agent_id uuid NOT NULL,version_id uuid NOT NULL,tool_key text NOT NULL CHECK(tool_key='knowledge.search'),
 PRIMARY KEY(version_id,tool_key),FOREIGN KEY(org_id,agent_id,version_id) REFERENCES public.agent_versions(org_id,agent_id,id)
);
CREATE TABLE public.agent_version_knowledge_bases (
 org_id uuid NOT NULL,agent_id uuid NOT NULL,version_id uuid NOT NULL,knowledge_base_id uuid NOT NULL,
 PRIMARY KEY(version_id,knowledge_base_id),FOREIGN KEY(org_id,agent_id,version_id) REFERENCES public.agent_versions(org_id,agent_id,id),
 FOREIGN KEY(org_id,knowledge_base_id) REFERENCES public.knowledge_bases(org_id,id)
);
CREATE TABLE public.agent_channel_links (
 org_id uuid NOT NULL,device_id uuid PRIMARY KEY,agent_id uuid NOT NULL,updated_by uuid,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,device_id) REFERENCES public.devices(org_id,id),FOREIGN KEY(org_id,agent_id) REFERENCES public.agents(org_id,id)
);
-- Automatic upgrade links are safe only where exactly one active agent exists.
INSERT INTO public.agent_channel_links(org_id,device_id,agent_id)
 SELECT d.org_id,d.id,a.id FROM public.devices d JOIN public.agents a ON a.org_id=d.org_id AND a.active
 WHERE (SELECT count(*) FROM public.agents x WHERE x.org_id=d.org_id AND x.active)=1;
INSERT INTO public.agent_version_tools SELECT v.org_id,v.agent_id,v.id,t.key FROM public.agent_versions v
 CROSS JOIN LATERAL jsonb_array_elements_text(v.config->'tools') t(key) WHERE t.key='knowledge.search';
INSERT INTO public.agent_version_knowledge_bases SELECT v.org_id,v.agent_id,v.id,k.id FROM public.agent_versions v
 CROSS JOIN LATERAL jsonb_array_elements_text(v.config->'knowledgeBaseIds') refs(id)
 JOIN public.knowledge_bases k ON k.id=refs.id::uuid AND k.org_id=v.org_id;
CREATE FUNCTION public.guard_agent_snapshot_links() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
 BEGIN
  IF TG_OP='INSERT' AND current_setting('wa.build_agent_version',true)=NEW.version_id::text THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Published agent links are immutable' USING ERRCODE='55000';
 END; $$;
CREATE TRIGGER immutable_agent_tools BEFORE INSERT OR UPDATE OR DELETE ON public.agent_version_tools FOR EACH ROW EXECUTE FUNCTION public.guard_agent_snapshot_links();
CREATE TRIGGER immutable_agent_knowledge BEFORE INSERT OR UPDATE OR DELETE ON public.agent_version_knowledge_bases FOR EACH ROW EXECUTE FUNCTION public.guard_agent_snapshot_links();
REVOKE ALL ON FUNCTION public.guard_agent_snapshot_links() FROM PUBLIC,anon,authenticated;
ALTER TABLE public.agent_version_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_version_knowledge_bases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_channel_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_version_tools,public.agent_version_knowledge_bases,public.agent_channel_links FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.agent_version_tools,public.agent_version_knowledge_bases,public.agent_channel_links TO service_role;

-- One database transaction owns each edit, receipt, publication, rollback or channel assignment.
CREATE FUNCTION public.mutate_agent_config(p_org uuid,p_actor uuid,p_agent uuid,p_action text,p_payload jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a public.agents; d public.agent_drafts; source public.agent_versions; v public.agent_versions;
 cfg jsonb; kb text; next_number integer;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_actor AND org_id=p_org AND active AND role IN ('owner','admin'))
 THEN RAISE EXCEPTION 'Administrator membership required' USING ERRCODE='42501'; END IF;
 IF p_action='create' THEN
  cfg:=p_payload->'config';
  INSERT INTO public.agents(id,org_id,name,system_prompt,temperature,max_tokens,knowledge_base_id,default_flow_id,active)
   VALUES(p_agent,p_org,cfg#>>'{identity,name}',cfg->>'instructions',(cfg#>>'{modelPolicy,temperature}')::float,
    (cfg#>>'{modelPolicy,maxTokens}')::integer,(cfg->'knowledgeBaseIds'->>0)::uuid,(cfg->>'defaultFlowId')::uuid,false);
 END IF;
 SELECT * INTO a FROM public.agents WHERE id=p_agent AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Agent not found' USING ERRCODE='P0002'; END IF;
 SELECT * INTO d FROM public.agent_drafts WHERE agent_id=p_agent AND org_id=p_org FOR UPDATE;
 IF p_action='create' THEN
  INSERT INTO public.agent_drafts(org_id,agent_id,config,updated_by) VALUES(p_org,p_agent,cfg,p_actor) RETURNING * INTO d;
 ELSE
  IF p_action IN ('save','test','publish','rollback') AND (d.revision IS DISTINCT FROM (p_payload->>'expectedRevision')::integer
    OR a.published_version_id IS DISTINCT FROM (p_payload->>'expectedPublishedVersionId')::uuid)
  -- A domain conflict must not use 40001: PostgREST 14 retries that SQLSTATE indefinitely.
  THEN RAISE EXCEPTION 'Configuration changed; reload before retrying' USING ERRCODE='PT409'; END IF;
  IF p_action='save' THEN cfg:=p_payload->'config';
  ELSIF p_action='rollback' THEN
   SELECT * INTO source FROM public.agent_versions WHERE id=(p_payload->>'versionId')::uuid AND org_id=p_org AND agent_id=p_agent;
   IF NOT FOUND THEN RAISE EXCEPTION 'Version not found' USING ERRCODE='P0002'; END IF;
   cfg:=source.config;
  ELSE cfg:=d.config; END IF;
 END IF;
 IF p_action IN ('create','save','test','publish','rollback') THEN
  FOR kb IN SELECT jsonb_array_elements_text(cfg->'knowledgeBaseIds') LOOP
   PERFORM 1 FROM public.knowledge_bases WHERE id=kb::uuid AND org_id=p_org FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Knowledge base not found' USING ERRCODE='P0002'; END IF;
  END LOOP;
  IF cfg->>'defaultFlowId' IS NOT NULL THEN
   PERFORM 1 FROM public.flows WHERE id=(cfg->>'defaultFlowId')::uuid AND org_id=p_org FOR KEY SHARE;
   IF NOT FOUND THEN RAISE EXCEPTION 'Flow not found' USING ERRCODE='P0002'; END IF;
  END IF;
 END IF;
 IF p_action='save' THEN
  UPDATE public.agent_drafts SET config=cfg,revision=revision+1,tested_revision=NULL,updated_by=p_actor,updated_at=now()
   WHERE agent_id=p_agent AND org_id=p_org RETURNING * INTO d;
 ELSIF p_action='test' THEN
  UPDATE public.agent_drafts SET tested_revision=revision WHERE agent_id=p_agent AND org_id=p_org RETURNING * INTO d;
 ELSIF p_action IN ('publish','rollback') THEN
  IF p_action='publish' AND d.tested_revision IS DISTINCT FROM d.revision THEN
   RAISE EXCEPTION 'Run mandatory draft tests before publishing' USING ERRCODE='55000'; END IF;
  SELECT coalesce(max(version_number),0)+1 INTO next_number FROM public.agent_versions WHERE agent_id=p_agent AND org_id=p_org;
  INSERT INTO public.agent_versions(org_id,agent_id,version_number,config,parent_version_id,restored_from_version_id,created_by,published_by)
   VALUES(p_org,p_agent,next_number,cfg,a.published_version_id,source.id,p_actor,p_actor) RETURNING * INTO v;
  PERFORM set_config('wa.build_agent_version',v.id::text,true);
  INSERT INTO public.agent_version_tools SELECT p_org,p_agent,v.id,value FROM jsonb_array_elements_text(cfg->'tools');
  INSERT INTO public.agent_version_knowledge_bases SELECT p_org,p_agent,v.id,value::uuid FROM jsonb_array_elements_text(cfg->'knowledgeBaseIds');
  PERFORM set_config('wa.build_agent_version','',true);
  UPDATE public.agents SET published_version_id=v.id,active=true WHERE id=p_agent AND org_id=p_org;
  -- Preserve legacy runtime columns; compatibility consumers can still read them during rollout.
  IF p_action='rollback' THEN
   UPDATE public.agent_drafts SET config=cfg,revision=revision+1,tested_revision=NULL,updated_by=p_actor,updated_at=now()
    WHERE agent_id=p_agent AND org_id=p_org RETURNING * INTO d;
  ELSE
   UPDATE public.agent_drafts SET tested_revision=NULL WHERE agent_id=p_agent AND org_id=p_org RETURNING * INTO d;
  END IF;
 ELSIF p_action='link' THEN
  PERFORM 1 FROM public.devices WHERE id=(p_payload->>'deviceId')::uuid AND org_id=p_org FOR KEY SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Device not found' USING ERRCODE='P0002'; END IF;
  INSERT INTO public.agent_channel_links(org_id,device_id,agent_id,updated_by)
   VALUES(p_org,(p_payload->>'deviceId')::uuid,p_agent,p_actor)
   ON CONFLICT(device_id) DO UPDATE SET agent_id=p_agent,updated_by=p_actor,updated_at=now();
 ELSIF p_action='metadata' THEN
  UPDATE public.agents SET name=coalesce(p_payload->>'name',name),active=coalesce((p_payload->>'active')::boolean,active)
   WHERE id=p_agent AND org_id=p_org;
 ELSIF p_action NOT IN ('create','save','test','publish','rollback') THEN
  RAISE EXCEPTION 'Unsupported action' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.agent_config_events(org_id,agent_id,actor_id,action,details)
  VALUES(p_org,p_agent,p_actor,p_action,jsonb_build_object('revision',d.revision,'versionId',v.id,'deviceId',p_payload->>'deviceId'));
 RETURN jsonb_build_object('draft',to_jsonb(d),'version',to_jsonb(v),'publishedVersionId',coalesce(v.id,a.published_version_id));
END; $$;
REVOKE ALL ON FUNCTION public.mutate_agent_config(uuid,uuid,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mutate_agent_config(uuid,uuid,uuid,text,jsonb) TO service_role;
COMMIT;
