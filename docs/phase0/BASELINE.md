# Phase 0 baseline — 6 October 2026

Scope: baseline inspection, documentation and an executable safety harness. No Phase 1–11 runtime functionality is implemented by this work.

## Authority and source identity

The human request limits work to Phase 0. `Master_Codex_Implementation_Prompt_v1.md` was read completely and controls the upgrade within that limit. The current source files establish existing behavior. `Instraction V4.txt` supports requirements. Historical summaries and guides are reference material, not implementation evidence; three historical documents now carry explicit banners.

The workspace is an extracted source tree without `.git` or an existing test harness. The named `Whatsapp_AI_Agent-main(2).zip` / `Whatsapp_AI_Agent-main(2) .zip` was not present. The available sibling archive is:

```text
F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\Whatsapp_AI_Agent-main.zip
SHA256 A8F73FE512D1932627358D1132F8A7985EBA4804DA1F3E879024AB2B295074AA
432 file entries under Whatsapp_AI_Agent-main/
Pre-change comparison: 0 differing files; 0 missing files.
```

The workspace also contained the supplied master prompt, upload references and supporting requirements. They were preserved. No Git repository was initialized, commit invented, remote changed, service deployed or production database contacted.

## Package and tooling baseline

Node requirement: `>=22 <23`; npm requirement: `>=10`; declared package manager: `npm@10.9.7`. Execution used Node `22.23.2` and npm `10.9.8` on Windows/PowerShell.

| Package | Existing scripts before Phase 0 |
| --- | --- |
| Root | `dev`, `dev:frontend`, `dev:backend`, `build`, `start`, `lint`, `typecheck`, `import:properties` |
| Backend | `dev`, `clean`, `build`, `start`, `typecheck`, `backfill:contact-memory` |
| Frontend | `dev`, `build`, `start`, `lint`, `typecheck`, `import:properties` |

Root scripts orchestrate npm workspaces. Root lint only runs frontend ESLint; there is no backend lint script. The actual frontend build uses `frontend/next.config.ts`, which does not skip TypeScript errors; the unused root Next config has `ignoreBuildErrors: true`. Frontend imports properties with Bun; normal build/tests use Node/npm. The mini-service is not a declared root workspace.

Added exact development dependencies: Vitest 4.1.11, Vite 7.3.7, Playwright 1.63.0, React Testing Library 16.3.3, DOM Testing Library 10.4.1, user-event 14.6.7, jest-dom 6.9.1, jsdom 26.1.0, Supertest 7.3.1 and corresponding jsdom/Supertest types. Production dependency declarations and runtime package versions are unchanged. A shared development type dependency, `@types/estree`, updated from 1.0.8 to 1.0.9. Workspace-local lockfiles remain historical artifacts; root `npm ci` uses the root lockfile.

Vitest 4.1.11 installation failed in npm Arborist with `Cannot read properties of null (reading 'edgesOut')` under both npm 10.9.8 and 10.9.7. Version 4.0.18 was used temporarily, then replaced because the dependency audit identified a critical development-tool advisory. A one-time `npx npm@12.2.0 install --save-dev --save-exact vitest@4.1.11 vite@7.3.7 --no-audit` resolved the peer graph without bypassing peer dependencies. The initial npm 12 advisory lookup stalled and was terminated; installation without that lookup completed, and separate npm 10 audit commands recorded findings. Final clean installation/build/tests use the original npm 10.9.8, not npm 12. No global npm version or package-manager declaration changed. See installation logs.

## Inspected active runtime

```text
backend/src/index.ts
  Express JSON parser + health/setup endpoints + rate limiter + auth/org middleware
  /api/v1 route mounts
  server startup → WhatsAppGateway.bootstrap()

BaileysManager: messages.upsert
  → WhatsAppGateway.createSession/onMessages
  → MessageRouter.routeMessage(deviceId, orgId, message)
  → contact upsert + conversation lookup/create + inbound persistence
  → extractPropertyDetails + generateReply
  → contact JSON memory metadata + gateway text send + outbound persistence

generateReply
  → intentRouter.routeByIntent
  → company/agent deterministic responses, property query, or legacy router
  → configured Claude/Groq generation or deterministic fallback where reached
```

There is a separate frontend decision/provider path in `frontend/src/app/api/chat/route.ts`, including Anthropic/Groq/OpenAI handling. It has not been consolidated. Published agent versions, tenant company profiles and distributed leases are future target abstractions, not current implemented services.

Conversation memory uses both `contacts.contact_memory` JSONB and the normalized `contact_memory` table. Handoff has a separate service, but the active MessageRouter does not consume its AI result's handoff flag to execute a lifecycle transition. Baileys session ownership is process-local Maps. DB auth state exists in `DBAuthState.ts`; QR/session recovery behavior was inspected but not exercised with a live WhatsApp number.

QueueManager provides BullMQ queues/workers when Redis is configured. `processMessageJob()` in `queue/workers/MessageWorker.ts` only discards `job.data`. Live inbound processing is synchronous through MessageRouter, not proven durable queued execution. HybridRAG combines vector and lexical searches with tenant/KB arguments; live retrieval and poisoning defenses remain UNVERIFIED.

## Existing routes

Public backend entry routes: `/`, `/healthz`, `/api/v1/health`, `/api/v1/setup/status`. Backend route mounts are `auth`, `chat`, `devices`, `contacts`, `conversations`, `messages`, `properties`, `agents`, `knowledge`, `flows`, `bookings`, `analytics`, `nudges`, `settings`. The auth router applies its own middleware; the other listed application mounts use `requireAuth` and `requireOrgScope`.

`inventory.json` records each backend router method/path with its file/line, frontend App Router page/API file and exported HTTP methods, packages, environment variable names, and migration DDL. It is generated by `npm run baseline:inventory`. This inventories existing routes; it does not imply that every route is secure or fully tested. Static `/properties/stats` and `/properties/health` are declared after `/:ref`, a route-order issue retained for later review.

## Schema and migration history

There are 17 active SQL files with prefixes 001–016. Prefix 011 is duplicated (`011_message_deduplication.sql`, `011_properties_distress_deal.sql`). Both files remain unchanged; future sequencing begins at 017. `legacy/` remains reference-only and was not executed.

| Migration(s) | Source-level purpose |
| --- | --- |
| 001 | Core tables, constraints, indexes and timestamps |
| 002 | pgvector support |
| 003–004 | Company-specific property/team seed data |
| 005 | JWT `org_id`-based RLS via `current_org_id()` |
| 006–007 | Vector search and nudge SQL helpers |
| 008–009 | Sentiment, alerts and notification tables/functions |
| 010 | Direct/indirect inventory, partner fields, inventory gaps |
| 011 (two files) | Message lock/reply tables and property distress flag |
| 012 | Lead assignment table and contact assignment fields |
| 013 | Normalized contact memory and cleanup |
| 014–015 | Data/routing cleanup with destructive or company-specific updates |
| 016 | Unique conversation index on `(org_id, contact_id)` |

Core DDL includes organizations, users, devices, knowledge_bases, flows, team_members, agents, properties, contacts, conversations, baileys_sessions, messages, knowledge_chunks, flow_steps, contact_flows, bookings, lead_scores, nudge_jobs and handoff_events. Later SQL adds sentiment_history, alerts, notification_preferences, notification_rules, alert_templates, notifications, inventory_gaps, message_locks, message_replies, lead_assignments and contact_memory.

Useful inspected columns: `agents.system_prompt/temperature/max_tokens/knowledge_base_id/default_flow_id/active`; `properties.ref/ref_number/image_urls/source/distress_deal/available/type/category/transaction_type`; `messages.wa_message_id`; `contacts.contact_memory`; `conversations.device_id/handled_by/assigned_to`. Table definitions, changes, indexes, policies and destructive statements are preserved in `inventory.json`.

`supabase/migrations/README.md` and the original root setup section stop at 009, despite active SQL through 016. `scripts/apply-migrations.mjs` sorts numbered files but hardcodes local postgres connection values, has no migration ledger, and continues after failures. It was inspected and deliberately not executed. Historical migrations 014/015 include deletions/updates and placeholder nulling; 016 can fail if duplicate conversations already exist. Do not use the old script against a tenant DB as a Phase 0 verification shortcut.

**Live schema, clean-database migration replay, representative upgrade replay, backfill preservation, FK integrity and effective RLS behavior: UNVERIFIED.** Docker CLI is present, but the daemon's named pipe is unavailable; psql and a dedicated test database were not available. No migration was added or applied. Static DDL inventory and fake Supabase tests are not database verification.

## Environment requirements

The inventory records names and source locations only, never values. Backend `config/env.ts` searches backend `.env`, backend `.env.local`, root `.env`, root `.env.local`, then frontend `.env.local`, filling missing variables without overwriting existing values.

| Integration | Current keys/behavior |
| --- | --- |
| Supabase backend | `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SERVICE_KEY`) |
| Supabase frontend | public URL + `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; server service-role aliases |
| AI | `ANTHROPIC_API_KEY` / `CLAUDE_API_KEY` / `ANTHROPIC_KEY` / `CLAUDE_KEY`; `GROQ_API_KEY`; `OPENAI_API_KEY` for embeddings and frontend fallback |
| Queues | `REDIS_HOST`, `REDIS_PORT` (6379), `REDIS_PASSWORD`; TCP Redis |
| WhatsApp auth encryption | `WA_SESSION_ENCRYPTION_KEY`: 64 hex characters |
| App routing | `BACKEND_URL`, `NEXT_PUBLIC_BACKEND_URL`, `NEXT_PUBLIC_APP_URL`, `PORT` (3001), `NODE_ENV`, `TZ` (Asia/Dubai) |
| Optional integrations | Resend sender/key, Google OAuth keys/redirect, Stripe keys, realtime enable/URL |
| Declared but not authoritative membership | `JWT_SECRET`, `JWT_EXPIRY`, `COOKIE_DOMAIN`; existing auth primarily validates Supabase sessions |

`SUPABASE_SECRET_KEY` is listed in examples but is not an alias consumed by the inspected clients. Empty optional integrations permit degraded startup, which is verified by smoke tests; degraded startup is not evidence of live service readiness.

## Discrepancy and regression evidence

All source line references are approximate; source-manifest hashes preserve the inspected version. Production changes in each row: **none**.

| Requirement / historical implication | Observed implementation / root cause | Required future change | Executable evidence |
| --- | --- | --- | --- |
| Explicit membership; no arbitrary org | `auth.ts`, `requireAuth` ~65–137 and `resolveFallbackOrgId` ~151: unmapped users are assigned earliest org and shadow-mapped; lookup omits active checks | Phase 1 membership authorization | Tenant tests reproduce fallback and disabled-member acceptance (XFAIL) |
| Tenant company facts | `companyHandler.ts`, `getCompanyInfoAsString`/`buildCompanyResponse` ~18–119: shared `COMPANY` constants, no org input | Phase 2 org profiles | Two orgs receive identical company info (XFAIL) |
| Exact reference before search | `intentDetector.ts`, `PropertyIntent` ~12–22 lacks reference; `intentRouter.ts`, `routeByIntent` ~113–144 rejects searches without area, or defers unrecognized request | Phase 4 reference contract and lookup | `Send me property REF-123` does not reach exact lookup (XFAIL) |
| Preserve property type | `propertyHandler.ts`, `queryProperties` ~49–104 substitutes transaction category; does not forward apartment/villa type | Phase 4 canonical criteria | REF-D villa incorrectly survives apartment request at matcher boundary (XFAIL) |
| Another option / Arabic parity | `intentDetector.ts`, detection/extraction ~177–375 lacks another-option phrase and Arabic structured criteria | Phase 4 state/extraction | Another-option and full Arabic request (XFAIL) |
| Durable inbound identity | `MessageRouter.ts`, `storeMessage` ~312–342 omits WhatsApp ID; `routeMessage` ~37–104 has no dedupe claim | Phase 5 durable identity | ID persistence and sequential/concurrent/new-instance replay (XFAIL) |
| Real handoff | `MessageRouter.ts`, `processTextMessage` ~106–162 ignores handoff result; `handoffService.ts`, `notifyAgent` ~103 logs only | Phase 6 lifecycle and notifications | Flag returned but no handoff event stored (XFAIL) |
| Durable queue/session ownership | `MessageWorker.ts`, `processMessageJob` ~9 stub; `WhatsAppGateway.ts` ~122 local Maps | Phase 10 ownership and workers | Inspected only; distributed behavior UNVERIFIED |

The corpus covers all eight required Phase 0 inputs. A passing `Hi` case verifies intent routing into the existing general path, not live LLM quality. A passing agent-request case verifies its returned flag, not an accepted handoff. The new-router replay is a dependency-isolated instance recreation, not an actual database-backed process restart or multi-replica test.

## Test commands and runbook

```powershell
npm ci
npm run typecheck
npm run typecheck:tests
npm run lint
npm run build
npx playwright install chromium
npm run test:unit
npm run test:integration
npm run test:tenant
npm run test:ai-regression
npm run test:e2e
npm run test:all
npm run test:strict
```

`npm test` runs all Vitest tests once. The corpus is additive and deterministic. Integration tests run real route/middleware/message code with explicit database/model/transport doubles. Unit tests cover extraction, pagination and the real login component via Testing Library/user-event. Supertest attempts forged org queries and cross-tenant IDs. Playwright starts the built frontend/backend and checks anonymous login and degraded backend behavior on desktop and mobile Chromium.

Vitest blocks accidental fetch calls; doubles contain fixture data only. The Playwright launcher refuses real `.env` files and strips runtime integration credentials from inherited environment variables. E2E runs at ports 3100/3101, does not reuse existing servers and does not pair a real WhatsApp account. Build first, use a disposable checkout without live `.env` files, then run E2E. Playwright keeps its artifacts separate from Vitest so neither erases the other's report.

`knownGap()` executes setup and observation outside its narrow AssertionError handler. Tests with known unmet invariants are printed as **XFAIL**, and their actual assertion errors are stored in `test-results/vitest/baseline.json`. Setup errors, unrelated errors, and unexpected improvements fail the run. XFAILs are not counted as passing behavior. `test:strict` exits 1 while any XFAIL exists, preventing a green baseline runner from being mistaken for release acceptance.

`node scripts/phase0-verify.mjs` runs the full command sequence, continues collecting evidence after failed gates and returns nonzero if any command fails. `--tests-only` rechecks harness types and all test commands without reinstalling/rebuilding; it replaces those entries in `verification.json`. Logs and per-suite reports are retained under `docs/phase0/logs/`. Test artifacts under `test-results/` are gitignored.

The source preservation test checks 329 captured source/schema/workspace-config files byte-for-byte. In a later explicitly authorized implementation phase, deliberately retire or adjust this Phase 0 guard for authorized changes; do not overwrite `source-manifest.json` to conceal differences.

## Current gates and deployment limits

Original and final clean dependency installs, application typecheck and builds passed. All added harness suites execute. Four existing frontend lint errors remain in EmbeddedSaaSFrame, ConversationList, MessageInput and MessageThread, plus one unused directive warning in LoginPage. Lint rules were not relaxed and UI code was not altered to hide the failures.

Final baseline: **24 PASS, 12 XFAIL, 0 unexpected FAIL**, plus **4 browser smoke PASS**. Strict gate fails as designed because the 12 defects remain. Suite counts overlap for `test:ai-regression` because it includes the message-router tests; do not sum per-script counts.

Dependency audit reports are retained as `logs/audit-all.json` and `logs/audit-production.json`; the phase report records final counts. The production baseline has 34 findings (3 low / 12 moderate / 14 high / 5 critical). These are npm advisory findings, not confirmed exploit demonstrations. The temporary Vitest advisory was removed by updating only the new development tooling. No `audit fix --force` or broad production dependency upgrade was attempted. No security, scalability or production-readiness claim is made.

Next emits existing multiple-lockfile and standalone/`next start` warnings. Compilation, basic startup and login smoke pass despite those warnings. RLS, real provider responses, complete tenant endpoint coverage, real WhatsApp QR/reconnect, queues, full accessibility/RTL, migration replay and load/failure recovery remain UNVERIFIED at this baseline. Later phase release gates remain mandatory.

## Rollback

Before dependency installation or edits, the complete workspace was archived to:

```text
F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\phase0-pre-change-20261006.zip
SHA256 D7D125D707C9216F867788A651906A88470F48A05753B55683A0B3E67E469D1F
```

For selective rollback, restore root `package.json`, `package-lock.json`, `.gitignore`, `README.md` and the three bannered historical documents from this snapshot; remove only the added Phase 0 configs/scripts/tests/docs after reviewing later edits; then run `npm ci`. A full rollback should extract the snapshot into a new sibling directory and compare before replacing the current workspace. Do not recursively delete the checkout or erase later user changes. No DB rollback is needed because no migration/data write occurred.

Phase 1 may start only after the human says **next phase**. Its dependencies are the captured baseline, tenant fixture harness and explicit membership tests. The runtime, migrations and original defects remain as inspected.
