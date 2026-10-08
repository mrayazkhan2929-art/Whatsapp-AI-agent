-- Phase 9: private append-only production execution evidence. No historical rows changed.
BEGIN;
CREATE TABLE public.execution_traces (
 id uuid PRIMARY KEY, org_id uuid NOT NULL REFERENCES public.organizations(id),
 source text NOT NULL CHECK(source IN ('http','whatsapp','helper')),
 device_id uuid, conversation_id uuid, inbound_message_id uuid, outbound_message_id uuid,
 agent_id uuid, agent_version_id uuid,
 status text NOT NULL CHECK(status IN ('completed','failed','skipped')),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=60000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX execution_trace_history ON public.execution_traces(org_id,created_at DESC,id DESC);
CREATE INDEX execution_trace_agent ON public.execution_traces(org_id,agent_id,created_at DESC);
CREATE INDEX execution_trace_message ON public.execution_traces(org_id,outbound_message_id) WHERE outbound_message_id IS NOT NULL;
CREATE FUNCTION public.guard_execution_trace() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE SQLSTATE '42501' USING MESSAGE='Trace evidence is immutable'; END IF;
 IF NEW.device_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM devices WHERE id=NEW.device_id AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Device not found'; END IF;
 IF NEW.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations c JOIN contacts t ON t.id=c.contact_id AND t.org_id=c.org_id WHERE c.id=NEW.conversation_id AND c.org_id=NEW.org_id) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Conversation not found'; END IF;
 IF NEW.agent_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agents WHERE id=NEW.agent_id AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Agent not found'; END IF;
 IF NEW.agent_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM agent_versions WHERE id=NEW.agent_version_id AND org_id=NEW.org_id AND (NEW.agent_id IS NULL OR agent_id=NEW.agent_id)) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Version not found'; END IF;
 IF NEW.inbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE id=NEW.inbound_message_id AND org_id=NEW.org_id AND conversation_id=NEW.conversation_id AND direction='inbound') THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Inbound not found'; END IF;
 IF NEW.outbound_message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages WHERE id=NEW.outbound_message_id AND org_id=NEW.org_id AND conversation_id=NEW.conversation_id AND direction='outbound') THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Outbound not found'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.evidence->'propertyIds','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM properties WHERE id=(item#>>'{}')::uuid AND org_id=NEW.org_id) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Property not found'; END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(COALESCE(NEW.evidence->'knowledgeSources','[]')) LOOP
  IF NOT EXISTS(SELECT 1 FROM knowledge_chunks c JOIN knowledge_bases k ON k.id=c.knowledge_base_id AND k.org_id=c.org_id JOIN knowledge_document_chunks l ON l.chunk_id=c.id AND l.org_id=c.org_id AND l.knowledge_base_id=c.knowledge_base_id JOIN knowledge_documents d ON d.id=l.document_id AND d.org_id=c.org_id AND d.knowledge_base_id=c.knowledge_base_id JOIN knowledge_document_versions v ON v.id=l.version_id AND v.document_id=d.id AND v.org_id=d.org_id WHERE c.id=(item->>'chunkId')::uuid AND c.org_id=NEW.org_id AND k.id=(item->>'knowledgeBaseId')::uuid AND d.id=(item->>'documentId')::uuid AND v.id=(item->>'versionId')::uuid) THEN RAISE SQLSTATE 'P0002' USING MESSAGE='Knowledge source not found'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER execution_trace_guard BEFORE INSERT OR UPDATE OR DELETE ON public.execution_traces FOR EACH ROW EXECUTE FUNCTION public.guard_execution_trace();
ALTER TABLE public.execution_traces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.execution_traces FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.execution_traces FROM service_role;
GRANT SELECT,INSERT ON public.execution_traces TO service_role;
REVOKE ALL ON FUNCTION public.guard_execution_trace() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
