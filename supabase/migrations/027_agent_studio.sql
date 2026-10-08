-- Phase 8: approved Studio capabilities and isolated draft test artifacts.
BEGIN;
ALTER TABLE public.agent_version_tools DROP CONSTRAINT agent_version_tools_tool_key_check;
ALTER TABLE public.agent_version_tools ADD CONSTRAINT agent_version_tools_tool_key_check CHECK(tool_key IN ('property.lookup','property.search','property.compare','property.send_media','knowledge.search','team.lookup','booking.create','handoff.create','contact.update','lead.qualify','calculator.roi','location.send'));
CREATE TABLE public.agent_playground_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),org_id uuid NOT NULL,agent_id uuid NOT NULL,actor_id uuid NOT NULL,
 draft_revision integer NOT NULL,config_sha256 text NOT NULL,summary jsonb NOT NULL CHECK(octet_length(summary::text)<=30000),created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(org_id,agent_id) REFERENCES public.agents(org_id,id)
);
CREATE INDEX agent_playground_history ON public.agent_playground_runs(org_id,agent_id,created_at DESC);
ALTER TABLE public.agent_playground_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.agent_playground_runs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.agent_playground_runs TO service_role;
CREATE FUNCTION public.guard_studio_handoff_reference() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NEW.config#>>'{handoffPolicy,defaultMemberId}' IS NOT NULL THEN
  PERFORM 1 FROM team_members WHERE id=(NEW.config#>>'{handoffPolicy,defaultMemberId}')::uuid AND org_id=NEW.org_id AND active FOR KEY SHARE;
  IF NOT FOUND THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Related member not found'; END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER guard_studio_draft_member BEFORE INSERT OR UPDATE ON public.agent_drafts FOR EACH ROW EXECUTE FUNCTION public.guard_studio_handoff_reference();
CREATE TRIGGER guard_studio_version_member BEFORE INSERT ON public.agent_versions FOR EACH ROW EXECUTE FUNCTION public.guard_studio_handoff_reference();
REVOKE ALL ON FUNCTION public.guard_studio_handoff_reference() FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.unlink_agent_channel(p_org uuid,p_actor uuid,p_agent uuid,p_device uuid) RETURNS void LANGUAGE plpgsql SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p_actor AND org_id=p_org AND active AND role IN ('admin','owner')) THEN RAISE SQLSTATE '42501' USING MESSAGE='Administrator required'; END IF;
 PERFORM 1 FROM agents WHERE id=p_agent AND org_id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Agent not found'; END IF;
 DELETE FROM agent_channel_links WHERE org_id=p_org AND agent_id=p_agent AND device_id=p_device;
 IF NOT FOUND THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Channel not found'; END IF;
 INSERT INTO agent_config_events(org_id,agent_id,actor_id,action,details) VALUES(p_org,p_agent,p_actor,'unlink',jsonb_build_object('deviceId',p_device));
END $$;
CREATE FUNCTION public.search_draft_knowledge(p_org uuid,p_agent uuid,p_revision integer,p_kb uuid,p_query text)
 RETURNS TABLE(id uuid,content text,document_id uuid,version_id uuid,version_number integer,chunk_index integer,score float)
 LANGUAGE plpgsql STABLE SET search_path=public AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM agent_drafts d JOIN agents a ON a.id=d.agent_id AND a.org_id=d.org_id JOIN knowledge_bases k ON k.org_id=d.org_id AND k.id=p_kb
 WHERE d.org_id=p_org AND d.agent_id=p_agent AND d.revision=p_revision AND d.config->'knowledgeBaseIds' ? p_kb::text AND d.config->'tools' ? 'knowledge.search') THEN RAISE SQLSTATE 'PT409' USING MESSAGE='Draft knowledge scope changed'; END IF;
 RETURN QUERY SELECT c.id,c.content,d.id,v.id,v.version_number,l.chunk_index,greatest(ts_rank_cd(to_tsvector('simple',normalize_knowledge_text(c.content)),plainto_tsquery('simple',normalize_knowledge_text(p_query))),ts_rank_cd(to_tsvector('english',c.content),plainto_tsquery('english',p_query)))::float s
 FROM knowledge_chunks c JOIN knowledge_document_chunks l ON l.chunk_id=c.id AND l.org_id=c.org_id AND l.knowledge_base_id=c.knowledge_base_id
 JOIN knowledge_documents d ON d.id=l.document_id AND d.org_id=c.org_id AND d.knowledge_base_id=c.knowledge_base_id AND d.current_version_id=l.version_id
 JOIN knowledge_document_versions v ON v.id=l.version_id AND v.document_id=d.id AND v.org_id=d.org_id AND v.status='ready'
 WHERE c.org_id=p_org AND c.knowledge_base_id=p_kb AND d.enabled AND d.deleted_at IS NULL
 AND (to_tsvector('simple',normalize_knowledge_text(c.content))@@plainto_tsquery('simple',normalize_knowledge_text(p_query)) OR to_tsvector('english',c.content)@@plainto_tsquery('english',p_query)) ORDER BY s DESC,c.id LIMIT 10;
END $$;
REVOKE ALL ON FUNCTION public.unlink_agent_channel(uuid,uuid,uuid,uuid),public.search_draft_knowledge(uuid,uuid,integer,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.unlink_agent_channel(uuid,uuid,uuid,uuid),public.search_draft_knowledge(uuid,uuid,integer,uuid,text) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
