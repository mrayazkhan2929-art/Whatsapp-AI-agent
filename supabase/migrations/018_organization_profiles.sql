-- Phase 2: tenant company configuration. No historical tenant facts are backfilled.
BEGIN;
CREATE TABLE public.organization_profiles (
  org_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  legal_name text NOT NULL CHECK (length(btrim(legal_name)) BETWEEN 1 AND 200),
  short_name text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', logo_url text NOT NULL DEFAULT '',
  office_address text NOT NULL DEFAULT '', map_url text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', whatsapp text NOT NULL DEFAULT '',
  timezone text NOT NULL DEFAULT 'UTC',
  working_hours jsonb NOT NULL DEFAULT '{"summary":""}'::jsonb CHECK (jsonb_typeof(working_hours) = 'object'),
  service_areas text[] NOT NULL DEFAULT '{}', license_number text NOT NULL DEFAULT '', license_authority text NOT NULL DEFAULT '',
  social_links jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(social_links) = 'object'),
  company_facts jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(company_facts) = 'object'),
  legal_disclaimer text NOT NULL DEFAULT '', approved_marketing_statements text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organization_profiles ENABLE ROW LEVEL SECURITY;
-- Membership and roles are resolved by the application, never from JWT metadata.
REVOKE ALL ON public.organization_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organization_profiles TO service_role;
COMMIT;
