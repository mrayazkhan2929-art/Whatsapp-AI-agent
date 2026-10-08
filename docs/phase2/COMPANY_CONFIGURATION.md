# Tenant company configuration

The current implementation resolves company facts from `organization_profiles` using the organization established by backend membership authorization. Historical company summaries and `COMPANY` in `companyData.ts` are reference material, never a runtime company fallback. The remaining legacy staff directory is outside Phase 2; versioned agents and runtime links belong to Phase 3.

## Storage and API contract

`018_organization_profiles.sql` adds one profile per existing organization, with a primary/foreign key, row-level security and explicit denial of direct anonymous/authenticated REST access. Only the server service role has table privileges. Existing application authentication resolves membership and roles from database rows; JWT metadata and client organization fields never choose the company.

The migration adds no profile rows. No original organization has been verified for a compatibility backfill. Missing profiles return `data: null`; company replies explicitly say configuration is missing. Lookup failures return errors instead of company defaults.

| Surface | Read | Save |
| --- | --- | --- |
| Backend | `GET /api/v1/settings/company-profile` | `PATCH /api/v1/settings/company-profile` |
| Frontend | `GET /api/settings/company-profile` | `PATCH /api/settings/company-profile` |

Reads require an active authorized membership. Saves require a stored `owner` or `admin` role. The frontend forwards identity to the canonical backend. Successful responses use `{ success: true, data: profileOrNull }`. Invalid input returns 400, invalid identity 401, insufficient membership/role 403, database lookup/save errors 500, and unavailable authentication infrastructure 503. Foreign profile ID paths are unsupported and return 404. Supplied `org_id`, `orgId`, creation times and update times are stripped.

Saves accept a complete company document. `legal_name` is required; omitted optional fields use their documented empty defaults. The UI submits every company field. Saves use the server organization as the conflict key and preserve separate organization/workspace automation preferences. Concurrent saves use last-write-wins; profile history and publishing are not part of this phase.

| Field | Validation / representation |
| --- | --- |
| `legal_name`, `short_name` | Required legal name, optional sidebar brand name; 200/100 characters |
| `description`, `legal_disclaimer` | Optional text, at most 4,000 characters each |
| `logo_url`, `map_url`, `website` | Empty or valid HTTP/HTTPS URLs; 2,000 characters |
| `phone`, `whatsapp`, `email` | Optional phone strings; empty or valid email |
| `timezone` | Valid IANA timezone; neutral default `UTC` |
| `working_hours` | JSON object with a free-text `summary`, at most 1,000 characters |
| `service_areas`, `approved_marketing_statements` | At most 50 nonempty strings, 500 characters each |
| `license_number`, `license_authority` | Optional text, at most 200 characters |
| `social_links` | At most 15 named HTTP/HTTPS links |
| `company_facts` | At most 30 named verified text facts; labels 80 / values 2,000 characters |

Leadership questions use the matching `owner`, `ceo` or `founder` company fact, case-insensitively. An owner is not automatically described as CEO. A missing leadership fact gets an explicit unconfigured response.

## Runtime behavior

`OrganizationProfileService` performs scoped reads and validated upserts. `RuntimeConfigResolver` is a foundation containing only the requested organization, company profile and configured flag. It has no global or cross-tenant cache. Updates affect the next resolution without code changes or application restarts.

Company intent replies are deterministic and bypass providers. Both backend routing paths use the company handler. The frontend company chat path delegates to the backend, including authorized conversation persistence. Both general prompt builders consume the tenant profile. The AI sanitizer and WhatsApp gateway no longer rewrite tenant domains or office addresses to IERE facts. Generic formatting/property behavior remains in place.

The company settings workspace has Identity, Contact, Operations and Trust & facts sections; a live logo/contact preview; profile completeness; responsive layouts; keyboard-accessible tabs; loading/error states; inline validation; discard, save and retry behavior; and a browser-unload warning for unsaved edits. Members without an editing role see disabled fields. Sidebar branding uses the current tenant's profile; an unconfigured profile displays neutral workspace branding. Existing preferences remain in their own tab.

Logos are URL-based and rendered by the browser with an avatar fallback. No upload service or backend image fetch was added. URL validation does not establish ownership or availability of an external image. Working hours are descriptive; timezone/working-hour scheduler changes are outside Phase 2.

## Reproduction and evidence

Run `npm ci`, `npm run build`, then `npm run test:company:db`. The harness refuses actual environment files, generates local credentials, uses unique Docker names and loopback ports, and tears down only its own disposable containers/storage. It replays all active numeric SQL files in filename order, including both `011` files and the additive `017` guard; `legacy/` is excluded. It fails on replay errors.

The official pinned `self-hosted/v0.8.2` DB/Auth/REST images and immutable digests are recorded in `distribution.json`. `profile-upgrade-check.json` proves historical row fingerprints remained unchanged across migration 018 and that no unverified profile was inserted. `database-access-audit.json` records RLS/grants. No migration was applied to a live Supabase project.

The suite includes all 76 existing real database security tests and 41 company tests. The company suite exercises real Supabase identities through both HTTP applications, preserves Tenant B snapshots after every test, and includes five actual browser scenarios. WhatsApp and backend provider methods are fail-fast stubs; unexpected external backend fetches fail the suite. Frontend provider credentials are removed by the harness. External logo requests use fixture images, while the UI, Auth, REST and application services are real.

Screenshots and the raw automated browser recording are under `artifacts/`. Three frames from the 2.76-second recording were extracted and reviewed, alongside full-resolution desktop and mobile screenshots. The middle recording frame shows the expected reload skeleton; the final frame shows the saved profile. No browser page errors were recorded. No manual computer-use session or deployment was performed.

The dedicated company suite is excluded from ordinary Vitest runs because it requires the disposable stack. Use `npm run test:company:db` to run it together with the inherited database security suite. `node scripts/phase2-verify.mjs` records all phase gates and returns failure when inherited lint or strict failures remain.

The schema approach follows [Supabase's RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security); the local stack follows the [official Docker distribution](https://supabase.com/docs/guides/self-hosting/docker). The Supabase changelog was checked; no SDK or database upgrade was needed for Phase 2. Native Supabase CLI remains blocked by Windows Application Control, so verification used the already authorized Docker approach.
