# PHASE 2 COMPLETE

Completed locally on 2026-10-06. Phase 3 has not started. The implementation uses the selected **modern, calm SaaS with subtle accents** direction.

## 1. Objective

Make each tenant's company identity, contact details and approved facts configurable without source edits. Prove isolation across runtime replies, profile APIs and UI branding. Implement only Phase 2 and the company-fact replacements needed to make it effective.

## 2. Files changed

19 implementation/test/config files changed; one generated TypeScript cache also changed. Full paths, changes and created files are recorded in `file-changes.json`.

- Backend: settings routes; the historical company-data reference comment; company handler; company intent detection/routing; both prompt/message builders; AI sanitizing/fallback identity; legacy company routing; WhatsApp gateway domain rewriting.
- Frontend: settings page, sidebar, neutral shared footer/help branding, company chat delegation and general prompt facts.
- Harness: root package scripts, company regression and baseline preservation tests.

Phase 0 and Phase 1 evidence, all historical SQL including `legacy/`, existing environment examples, lockfiles and unrelated application source remained unchanged. Source changes are restricted by the explicit Phase 2 allowlist.

## 3. Files created

- `backend/src/modules/company/OrganizationProfileService.ts`
- `backend/src/modules/company/RuntimeConfigResolver.ts`
- `backend/src/modules/company/formatCompanyProfile.ts`
- `frontend/src/app/api/settings/company-profile/route.ts`
- `frontend/src/lib/company-profile.ts`
- `frontend/src/components/pages/CompanyProfileWorkspace.tsx`
- `supabase/migrations/018_organization_profiles.sql`
- `tests/unit/company-profile.test.ts`, `tests/tenant-db/company-profile.test.ts`
- `vitest.phase2-db.config.ts`
- `scripts/phase2-db.mjs`, `scripts/phase2-verify.mjs`, `scripts/phase2-files.ps1`
- Phase 2 manifest, allowlist, technical documentation, report, command logs, sanitized database evidence and real UI artifacts.

## 4. Migrations added/applied

Added **018_organization_profiles.sql**, because Phase 1's explicitly authorized security guard occupies 017. No historical migration was renumbered or edited. All 19 active SQL files replayed successfully in deterministic filename order, including both 011 files; legacy SQL was excluded. Applied only to the disposable local Docker stack. No live database migration or deployment occurred.

Migration 018 creates the tenant profile table, organization primary/foreign key, RLS, and server-only grants. Existing row fingerprints were unchanged, and the new table remained empty until explicit fixture/configuration writes. No IERE/company facts were backfilled.

## 5. APIs added/changed

Added authenticated GET/PATCH company-profile endpoints under backend `/api/v1/settings` and frontend `/api/settings`. Backend membership remains authoritative. Owners/admins can save; other active members can read. Successful envelopes and identity failure statuses are preserved. The complete profile save strips client organization/timestamp fields.

Frontend company chat delegates to backend `/api/v1/chat`. Authorized company replies can still persist into the tenant's own conversation. Foreign conversation IDs are rejected before a reply is written.

## 6. UI added/changed

Company profile workspace with four clear sections, every required field, dynamic social/fact rows, live brand/contact preview, completeness indicator, accessible controls, responsive layout, inline errors, discard/save feedback and failed-save retry. Sidebar name/logo update from the tenant profile. Existing automation/workspace preferences remain available. Unconfigured branding is neutral.

Evidence: `artifacts/company-saved-desktop.png`, `company-mobile.png`, `company-trust-desktop.png`, `company-tenant-b.png`, and `company-profile-walkthrough.webm`. Screenshots and extracted recording frames were visually reviewed.

## 7. Runtime behavior changed

Company facts come only from the requested tenant's profile. No first organization, metadata assignment, global company fallback or cross-tenant profile cache was added. Missing profiles/leadership facts produce explicit unconfigured answers. Saved changes affect the next reply. Both prompt builders consume profile facts. Removed global IERE domain/address substitutions in the sanitizer and WhatsApp gateway.

Company replies remain deterministic and bypass providers. Property matching, agent versioning/publishing, scheduling and handoff lifecycle changes remain outside this phase.

## 8. Tests added

15 company unit cases cover scope, forged IDs/timestamps, fresh resolution after save, missing profiles, failed lookups, validation, sanitizer behavior, leadership facts and both prompt builders. Added an immutable Phase 1 source-checkpoint assertion. Converted the Phase 2 company-facts expected failure into an ordinary passing regression.

41 database/company cases cover authenticated A/B reads/replies/writes, forged query/body organization IDs, role denials, missing profiles, invalid links/identities, foreign conversation IDs, own-tenant persistence, direct REST denials, unchanged B snapshots, and five actual browser scenarios: edit/save/reload, mobile/keyboard, viewer/B branding, validation/discard/retry, and initial company creation.

## 9. Commands run

All command outputs are recorded in `verification.json` and `logs/`.

| Command | Exit | Result |
| --- | ---: | --- |
| `npm ci` | 0 | Clean installation; inherited dependency audit below |
| `npm run typecheck` | 0 | Frontend and backend |
| `npm run typecheck:tests` | 0 | Test sources |
| `npm run lint` | 1 | Four inherited errors and one inherited warning |
| `npm run build` | 0 | Production frontend and backend builds |
| `npm run test:unit` | 0 | 28 PASS, zero expected failures |
| `npm run test:integration` | 0 | 5 PASS, 6 retained expected failures |
| `npm run test:tenant` | 0 | 35 PASS, zero expected failures |
| `npm run test:tenant:strict` | 0 | Tenant strict gate passes |
| `npm run test:ai-regression` | 0 | 8 PASS, 8 retained expected failures |
| `npm run test:e2e` | 0 | 4 browser smoke tests pass |
| `npm run test:all` | 0 | 73 PASS, 9 expected failures; 4 browser smoke tests pass |
| `npm run test:strict` | 1 | Fails visibly for 9 known later-phase defects |
| `npm run test:company:db` | 0 | 117 real database/browser tests pass |

Final supplemental checks also passed: backend rebuild after the leadership refinement, application/test typechecks, ESLint on all changed/new frontend code, and 28 unit tests after pinning the Phase 1 checkpoint hash. `scripts/phase2-files.ps1` confirmed immutable Phase 0/1 evidence and historical SQL. Docker inspection found no remaining Phase 2 containers after cleanup.

## 10. Test results

**73 ordinary PASS, 9 retained expected failures, 0 unexpected failures, 0 module errors** in the standard suite. **117/117 PASS** in the disposable database suite (76 inherited security tests + 41 company tests, including five browser tests). Four existing browser smoke tests also pass. Tenant expected failures: **zero**. Phase 2 expected failures: **zero**.

Development checks initially exposed test selector/404 parsing mismatches. Those were corrected and the complete database suite then passed. Expected failures are recorded as defects, never reported as successful behavior.

## 11. Security/tenant checks

No observed cross-tenant reads or writes in the tested attack matrix; no arbitrary organization fallback. All 117 after-test B snapshots stayed byte-equivalent. The inherited matrix covers 26 tables; the company matrix adds profile coverage plus organization/member/contact/conversation/message snapshots.

There were 175 explicitly counted HTTP requests across the two suites, plus actual browser requests. Forged body/query organization IDs and JWT metadata do not select B's company. Invalid membership/role is denied before company writes. Foreign profile ID paths return 404; foreign conversation IDs return 404 before persistence. Anonymous and authenticated direct REST reads/inserts/updates/deletes on profiles return 42501. RLS/grants are recorded in `database-access-audit.json`.

Recorded company-provider calls: **0**; WhatsApp sends: **0**; unexpected external backend requests: **0**; browser page errors: **0**. All infrastructure was local, uniquely named and cleaned up. Real Auth/REST/database behavior was tested rather than inferred from mocks.

## 12. Known limitations

- Global lint remains blocked by unchanged `EmbeddedSaaSFrame`, `ConversationList`, `MessageInput` and `MessageThread` errors; unchanged `LoginPage` has one unused-disable warning. Changed/new frontend files pass targeted lint.
- Strict gating remains blocked by nine inherited Phase 4/5/6 property, inbound-idempotency and handoff defects. No later-phase functionality was implemented to hide them.
- Clean install reports 46 inherited vulnerabilities: 5 critical, 23 high, 14 moderate, 4 low. No dependency upgrades were introduced.
- Native Supabase CLI is blocked by Windows Application Control; the authorized pinned Docker distribution was used. No live deployment/database verification occurred.
- No original organization was verified for backfill. Existing tenants must explicitly configure their profile. Logos are external URLs with fallback, not uploads. Working hours are descriptive, not scheduling rules. Saves are complete documents with last-write-wins semantics; publishing/history belongs to later work.
- Legacy staff-directory behavior remains outside Phase 2. Company/leadership questions use profile facts and never use that directory as a company fallback.

## 13. Regression risk

Company responses intentionally stop supplying hardcoded IERE details for unconfigured tenants. General prompt calls now require the company profile table/service to be available. Deploy migration 018 before deploying these application changes. The sanitizer preserves configured domains/addresses instead of rewriting them to the original company. Ordinary formatting and existing preference settings remain intact. The retained expected failures and inherited lint errors limit the global release gate.

## 14. Rollback point

Pre-edit archive: `F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\phase2-pre-change-20261006-210338.zip` (6,414,147 bytes).

SHA-256: `2A03E23C115735C6D12D16D2652ADDCA5A8BFDBBAA0C24303A8EE1CEBB93162B`.

The immutable Phase 0 manifest hash remains `26012520EA88C51DE89B84BD2B27A3F82D92AD1B435FBC8C342B665DEC4D5850`. The Phase 1 source checkpoint captured in `docs/phase2/source-manifest.json` is `458EB726C8722378E552073FE7D38E11CC2999A8D09F16CA557880B369AAF9AF` and is pinned by the preservation test.

To roll back application code, stop the applications, verify the archive hash and extract into a separate fresh directory; preserve local environment files/configuration and reinstall from the archived root lockfile. Keep Phase 1's security guard 017. No live database rollback is required because none was changed. If 018 is deployed later, retain/export profile data before any separately authorized database rollback; do not edit historical migrations. Disposable local stacks have already been removed.

## 15. Next phase dependencies

Phase 3 requires a new explicit **next phase** authorization. It can build on the scoped profile service and resolver foundation. Its planned agent-version/runtime-link migrations must start at the next free numbers **019/020**, because 017 is the security guard and 018 is company profiles. No agent versioning, publishing, control-plane UI or later-phase implementation was started.

**STOP — awaiting explicit next-phase authorization.**
