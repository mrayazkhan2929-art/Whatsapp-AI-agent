-- Historical review proposal; not part of the active replay chain.
-- The user approved an additive exception to the original no-migration plan.
-- Active implementation: supabase/migrations/017_tenant_data_api_guard.sql.
-- Tested in disposable local databases only; no live project was migrated.
-- Existing application access uses service_role after backend membership checks.
-- This proposal removes direct anonymous/authenticated access to legacy objects
-- that bypass tenant RLS, without changing schema, data or migration history.
BEGIN;

ALTER VIEW public.ai_agents SET (security_invoker = true);
ALTER VIEW public.whatsapp_devices SET (security_invoker = true);
ALTER VIEW public.conversation_flows SET (security_invoker = true);
ALTER VIEW public.wa_session_keys SET (security_invoker = true);

-- Normalized memory has no org_id and no historical RLS policy.
-- Its application reads already validate the owning contact's organization.
REVOKE ALL ON TABLE public.contact_memory FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.contact_memory TO service_role;

COMMIT;
