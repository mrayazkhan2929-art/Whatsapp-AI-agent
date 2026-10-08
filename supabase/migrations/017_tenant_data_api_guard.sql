-- Phase 1: close inherited REST paths that bypass tenant ownership policies.
-- PostgreSQL 15+; application memory access remains behind server authorization.
BEGIN;

ALTER VIEW public.ai_agents SET (security_invoker = true);
ALTER VIEW public.whatsapp_devices SET (security_invoker = true);
ALTER VIEW public.conversation_flows SET (security_invoker = true);
ALTER VIEW public.wa_session_keys SET (security_invoker = true);

-- This legacy table has no org_id. Only the authorized server may access it,
-- after validating its owning contact against the resolved organization.
REVOKE ALL ON TABLE public.contact_memory FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contact_memory TO service_role;

COMMIT;
