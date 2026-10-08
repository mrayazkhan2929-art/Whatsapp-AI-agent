-- Phase 3: immutable published snapshots and revision-protected drafts.
BEGIN;
ALTER TABLE public.agents ADD CONSTRAINT agents_org_identity UNIQUE(org_id,id);
ALTER TABLE public.agents ADD COLUMN published_version_id uuid;
CREATE TABLE public.agent_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, agent_id uuid NOT NULL,
 version_number integer NOT NULL CHECK(version_number > 0), status text NOT NULL DEFAULT 'published' CHECK(status='published'),
 config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'), parent_version_id uuid,
 restored_from_version_id uuid, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 published_by uuid, published_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(org_id,agent_id,id), UNIQUE(agent_id,version_number),
 FOREIGN KEY(org_id,agent_id) REFERENCES public.agents(org_id,id),
 FOREIGN KEY(org_id,agent_id,parent_version_id) REFERENCES public.agent_versions(org_id,agent_id,id),
 FOREIGN KEY(org_id,agent_id,restored_from_version_id) REFERENCES public.agent_versions(org_id,agent_id,id)
);
ALTER TABLE public.agents ADD CONSTRAINT agents_published_version_owner FOREIGN KEY(org_id,id,published_version_id)
 REFERENCES public.agent_versions(org_id,agent_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE public.agent_drafts (
 org_id uuid NOT NULL, agent_id uuid PRIMARY KEY, config jsonb NOT NULL CHECK(jsonb_typeof(config)='object'),
 revision integer NOT NULL DEFAULT 1, tested_revision integer, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,agent_id) REFERENCES public.agents(org_id,id)
);
CREATE TABLE public.agent_config_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_id uuid NOT NULL, agent_id uuid NOT NULL, actor_id uuid,
 action text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,agent_id) REFERENCES public.agents(org_id,id)
);
-- Preserve all legacy values. Invalid historical related IDs remain visible to validation, never authorized by this backfill.
ALTER TABLE public.agents DISABLE TRIGGER agents_set_updated_at;
INSERT INTO public.agent_versions(org_id,agent_id,version_number,config)
 SELECT org_id,id,1,jsonb_build_object('schemaVersion',1,'identity',jsonb_build_object('name',name),
 'instructions',system_prompt,'languages',jsonb_build_array('en','ar'),
 'modelPolicy',jsonb_build_object('provider','auto','temperature',temperature,'maxTokens',max_tokens),
 'knowledgeBaseIds',CASE WHEN knowledge_base_id IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(knowledge_base_id) END,
 'defaultFlowId',default_flow_id,'tools',CASE WHEN knowledge_base_id IS NULL THEN '[]'::jsonb ELSE '["knowledge.search"]'::jsonb END)
 FROM public.agents;
UPDATE public.agents a SET published_version_id=v.id FROM public.agent_versions v WHERE v.agent_id=a.id;
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE public.agents ENABLE TRIGGER agents_set_updated_at;
INSERT INTO public.agent_drafts(org_id,agent_id,config) SELECT org_id,agent_id,config FROM public.agent_versions;
CREATE FUNCTION public.reject_agent_history_mutation() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
 BEGIN RAISE EXCEPTION 'Published agent history is immutable' USING ERRCODE='55000'; END; $$;
CREATE TRIGGER immutable_agent_versions BEFORE UPDATE OR DELETE ON public.agent_versions FOR EACH ROW EXECUTE FUNCTION public.reject_agent_history_mutation();
CREATE TRIGGER immutable_agent_events BEFORE UPDATE OR DELETE ON public.agent_config_events FOR EACH ROW EXECUTE FUNCTION public.reject_agent_history_mutation();
ALTER TABLE public.agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_config_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_versions,public.agent_drafts,public.agent_config_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.agent_versions,public.agent_drafts,public.agent_config_events TO service_role;
-- Direct REST writes must not bypass revision checks, mandatory tests or publication audit.
REVOKE INSERT,UPDATE,DELETE ON public.agents FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reject_agent_history_mutation() FROM PUBLIC,anon,authenticated;
COMMIT;
