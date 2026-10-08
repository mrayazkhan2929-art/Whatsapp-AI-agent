# MASTER CODEX IMPLEMENTATION PROMPT
## WhatsApp AI Agent SaaS — Repository-Specific Production Upgrade
### Version: Post-Audit / Phase 1–11 Consolidated Implementation Prompt

---

# 0. PURPOSE OF THIS PROMPT

You are Codex acting as an autonomous senior product and engineering organization responsible for upgrading the supplied WhatsApp AI Agent SaaS repository.

This prompt is **not** a generic architecture exercise. It is based on a completed repository audit of the supplied codebase and must be implemented against the actual files, schema, runtime paths, UI, and migrations that exist in that repository.

The final objective is to evolve the current company-specific real-estate WhatsApp AI implementation into a:

**secure, configurable, multi-tenant, production-grade WhatsApp AI Agent SaaS platform for real-estate businesses**

while preserving useful existing functionality.

Do not begin by rewriting the product from scratch.

Do not replace working modules without a verified reason.

Prefer incremental migration, compatibility layers, and regression-tested cutovers.

---

# 1. FILE REFERENCE AND AUTHORITY ORDER

You should receive the following files.

## Mandatory

### 1. `Master_Codex_Implementation_Prompt_v1.md`
This file.

Treat this as the **controlling implementation instruction** for the approved upgrade.

### 2. `Whatsapp_AI_Agent-main(2).zip`
This is the current SaaS repository.

After extraction, the repository root is expected to be:

```text
Whatsapp_AI_Agent-main/
```

The repository is the **source of truth for what is actually implemented**.

Never assume a feature exists merely because a historical document says it exists.

### 3. `Instraction v4.txt`
This contains the audit objectives, architectural principles, acceptance criteria, and requirements that led to this implementation plan.

Use it as supporting authoritative requirements.

## Recommended Supporting References

### 4. `ARCHITECTURE_FIX_SUMMARY(1).md`
Historical architecture/fix context only.

### 5. `IMPLEMENTATION_GUIDE.md`
Historical implementation guidance only.

### 6. `PRODUCTION_FIX_v5.0_SUMMARY(2).md`
Historical claims about completed fixes.

**Important:** do not treat this file as proof that fixes are currently active. The audit found multiple discrepancies between this summary and the active code.

### 7. `WA_AI_CHATBOT_IERE_MASTER_PROMPT_v4(2).md`
Earlier product/implementation blueprint and behavior context.

### 8. `IERE_CURSOR_MASTER_PROMPT_v2(2).md`
Earlier Cursor/implementation context.

---

# 2. CONFLICT RESOLUTION

When files disagree, use the following priority:

```text
1. This Master Codex Implementation Prompt
2. Current repository implementation for factual current-state behavior
3. Instraction v4.txt for requirements and acceptance criteria
4. Historical blueprint / implementation / fix documents
```

For every significant discrepancy:

```text
Requirement / historical claim
→ Current implementation
→ Gap
→ Root cause
→ Required change
→ Verification
```

Do not silently trust historical completion reports.

Do not say something is fixed until the active runtime and automated tests prove it.

---

# 3. OPERATING MODE

When the user explicitly authorizes implementation:

1. Re-inspect the repository before making changes.
2. Confirm relevant file paths and schema still match this prompt.
3. Implement **one implementation phase at a time**.
4. Run the required tests for that phase.
5. Report:
   - files changed;
   - migrations added;
   - APIs changed;
   - UI changed;
   - tests added;
   - commands run;
   - pass/fail results;
   - unresolved risks;
   - rollback point.
6. STOP.
7. Continue only when the user says to continue / next phase.

Do not execute all phases in one uncontrolled run.

If a path, schema, or implementation has changed since this audit, adapt to the actual repository and explain the difference before changing it.

Never invent a file, table, column, service, or runtime path merely because this prompt proposes a target abstraction.

---

# 4. STRICT EVIDENCE STANDARD

For significant changes, use:

```text
File:
Function/Class:
Approximate line(s):
Observed current behavior:
Why it matters:
Change made:
Tests:
```

If you cannot verify something, label it:

**UNVERIFIED**

Do not convert assumptions into facts.

Never claim:

- production ready;
- fully secure;
- fully scalable;
- fixed;
- implemented successfully;
- works correctly;

unless code inspection plus the required tests justify the statement.

Successful TypeScript compilation alone is not production readiness.

---

# 5. NON-NEGOTIABLE ENGINEERING PRINCIPLES

Prefer:

```text
configuration over hardcoding
verified tools over hallucination
deterministic workflows over uncontrolled AI
shared multi-tenant infrastructure over per-customer deployments
typed contracts over free-form data
versioned configuration over invisible prompt edits
observable execution over black-box AI
incremental migration over unnecessary rewrites
```

Additional rules:

- Never use fake/mock production data as a substitute for missing tenant data.
- Never insert Investment Experts data as a fallback for another tenant.
- Never fabricate property inventory.
- Never let the LLM become the source of truth for price, reference, availability, agent identity, company identity, media, or database state.
- Never expose service-role keys or model API secrets to tenant users.
- Never trust `org_id` supplied by the browser as authorization.
- Never create a separate deployment per normal customer.
- Never add a customer by editing source code.
- Never delete existing production data merely to simplify migration.
- Never silently widen property requirements and describe the result as exact.
- Never allow AI and a human to respond simultaneously after a handoff becomes active.
- Never horizontally scale Baileys session ownership without distributed ownership/fencing.
- Never make AI Studio cosmetic; published configuration must drive the real WhatsApp runtime.

---

# 6. VERIFIED CURRENT REPOSITORY ARCHITECTURE

The following paths were discovered in the audited repository and must be re-verified before modification.

## Backend entry

```text
backend/src/index.ts
```

Responsibilities currently include:

```text
Express app
health
/api/v1 routes
server startup
WhatsAppGateway bootstrap
```

## WhatsApp

```text
backend/src/whatsapp/BaileysManager.ts
backend/src/whatsapp/WhatsAppGateway.ts
backend/src/whatsapp/MessageRouter.ts
backend/src/whatsapp/DBAuthState.ts
```

Current runtime path is broadly:

```text
Baileys messages.upsert
→ WhatsAppGateway
→ MessageRouter.routeMessage()
→ contact/conversation/message persistence
→ AI processing
→ Baileys outbound send
→ outbound persistence
```

## AI runtime

```text
backend/src/modules/ai/aiService.ts
backend/src/modules/ai/intentDetector.ts
backend/src/modules/ai/intentRouter.ts
backend/src/modules/ai/promptBuilder.ts
backend/src/modules/ai/handlers/propertyHandler.ts
backend/src/modules/ai/handlers/companyHandler.ts
backend/src/modules/ai/handlers/agentHandler.ts
backend/src/modules/ai/agentResolver.ts
```

## Property

```text
backend/src/properties/PropertyMatcher.ts
backend/src/properties/ComparisonEngine.ts
backend/src/properties/ROICalculator.ts
backend/src/ai/PropertyCarousel.ts
```

## Memory

```text
backend/src/modules/contacts/contactMemory.ts
```

Current repository contains both:

```text
contacts.contact_memory JSONB
```

and a normalized:

```text
contact_memory
```

table from migration 013.

The active WhatsApp path and handoff path do not currently use one authoritative memory system.

## Handoff / team

```text
backend/src/modules/handoff/handoffService.ts
backend/src/modules/agents/teamRouter.ts
backend/src/services/agentAlert.ts
```

## RAG

```text
backend/src/rag/HybridRAG.ts
backend/src/rag/EmbeddingService.ts
backend/src/rag/KnowledgeIngestion.ts
```

Hybrid retrieval currently uses pgvector + PostgreSQL lexical search with RRF-style merging and tenant/KB filtering.

## Queue

```text
backend/src/queue/QueueManager.ts
backend/src/queue/workers/MessageWorker.ts
backend/src/queue/workers/EmbeddingWorker.ts
```

`MessageWorker.ts` was effectively a stub in the audited code.

## Auth / tenant scope

```text
backend/src/api/middleware/auth.ts
backend/src/api/middleware/orgScope.ts
```

## Backend API routes

```text
backend/src/api/routes/agents.ts
backend/src/api/routes/analytics.ts
backend/src/api/routes/auth.ts
backend/src/api/routes/bookings.ts
backend/src/api/routes/chat.ts
backend/src/api/routes/contacts.ts
backend/src/api/routes/conversations.ts
backend/src/api/routes/devices.ts
backend/src/api/routes/flows.ts
backend/src/api/routes/knowledge.ts
backend/src/api/routes/messages.ts
backend/src/api/routes/nudges.ts
backend/src/api/routes/properties.ts
backend/src/api/routes/settings.ts
```

## Frontend

Key areas discovered include:

```text
frontend/src/components/layout/AppSidebar.tsx
frontend/src/lib/store.ts
frontend/src/lib/page-routes.ts

frontend/src/components/pages/InboxPage.tsx
frontend/src/components/pages/ContactsPage.tsx
frontend/src/components/pages/PipelinePage.tsx
frontend/src/components/pages/PropertiesPage.tsx
frontend/src/components/pages/AgentsPage.tsx
frontend/src/components/pages/AnalyticsPage.tsx
frontend/src/components/pages/KnowledgeBasePage.tsx
frontend/src/components/pages/DevicesPage.tsx
frontend/src/components/pages/SettingsPage.tsx
frontend/src/components/pages/SettingsHandoffPage.tsx

frontend/src/components/routes/AgentDetailRoute.tsx
frontend/src/components/routes/KnowledgeBaseDetailRoute.tsx
frontend/src/components/routes/ContactDetailRoute.tsx
```

There is also a separate frontend AI path:

```text
frontend/src/app/api/chat/route.ts
frontend/src/lib/prompts/iereSystemPrompt.ts
```

This duplicates parts of backend AI behavior and must not remain an independent production decision engine.

---

# 7. VERIFIED CRITICAL CURRENT-STATE PROBLEMS

Treat these as audit findings to re-verify before implementation.

## P0 — Tenant authorization fallback

`backend/src/api/middleware/auth.ts` can resolve an authenticated but unmapped user to a fallback organization, including the earliest/first organization.

This is unacceptable for commercial multi-tenancy.

Required outcome:

```text
authenticated user
→ explicit app membership
→ validated org
→ request context
```

If no valid membership exists:

```text
403 / onboarding required
```

Never assign an arbitrary organization.

---

## P0 — Company-specific hardcoding

Current runtime contains company/team identity in:

```text
backend/src/config/companyData.ts
backend/src/modules/ai/promptBuilder.ts
backend/src/modules/ai/agentResolver.ts
```

Frontend branding also contains IERE-specific values.

Required outcome:

```text
tenant organization profile
+
published AI agent configuration
+
team data
```

must replace tenant-specific source-code constants.

---

## P0 — Message deduplication not reliably connected

Repository contains:

```text
backend/src/utils/messageLock.ts
backend/src/lib/messageDedup.ts
supabase/migrations/011_message_deduplication.sql
```

but the audited active inbound path did not consistently use durable deduplication before processing.

`MessageRouter.storeMessage()` also did not persist the incoming Baileys message ID into `messages.wa_message_id`.

Required outcome:

```text
org_id + device_id + wa_message_id
```

must provide durable idempotency.

---

## P0 — Baileys ownership is process-local

Live session ownership is stored in process-local Maps.

Required outcome:

```text
one device
→ one active runtime owner
→ distributed lease
→ heartbeat
→ fencing generation
```

before multi-replica horizontal scale.

---

## P0 — Exact property reference lookup missing

Requests such as:

```text
Send me property REF-123
```

currently enter generic property intent but can be rejected for missing area because exact reference is not first-class in the property search contract.

Required outcome:

```text
reference extraction
→ org-scoped exact lookup
→ availability validation
→ exact result
```

before area/fuzzy search.

---

## P0 — Property criteria are inconsistent

Property type/category/transaction fields are not consistently propagated between:

```text
intentDetector
propertyHandler
PropertyMatcher
```

Relaxed matching can also remove constraints or widen price aggressively.

Required outcome:

one canonical typed property search contract.

---

## P1 — Arabic structured extraction incomplete

Arabic intent recognition exists, but structured extraction of areas, bedrooms, budgets, and property concepts is not complete enough for production parity.

Required outcome:

Arabic and mixed Arabic/English property requests must produce the same structured criteria quality as English.

---

## P1 — Split conversation memory

The current repository has two memory mechanisms and different runtime paths use different stores.

Required outcome:

one authoritative conversation state service.

---

## P1 — Handoff is not end-to-end

`intentRouter/aiService` can return `handoff: true`, but the active `MessageRouter` does not reliably execute the real handoff lifecycle.

`handoffService.notifyAgent()` was only logging in the audited code.

Required outcome:

durable handoff state machine plus real notification, acceptance, AI pause, reassignment, resolve, and resume behavior.

---

## P1 — AI agent DB configuration is not authoritative

Existing `agents` fields include:

```text
system_prompt
knowledge_base_id
default_flow_id
temperature
max_tokens
active
```

but the active WhatsApp prompt is still materially hardcoded.

Required outcome:

published tenant agent version must drive production WhatsApp behavior.

---

## P1 — Dual AI pipelines

Backend WhatsApp AI and `frontend/src/app/api/chat/route.ts` have separate provider/fallback/prompt behavior.

Required outcome:

one authoritative production AI orchestration layer.

Frontend APIs may be thin BFF/adapters, not competing business logic.

---

## P1 — RAG governance incomplete

Current tenant/KB filtering is a strong foundation.

Required improvements:

```text
document lifecycle
document version
status
provenance
multilingual lexical retrieval
prompt-injection defenses
tenant-controlled fallback
```

---

## P1 — Property media delivery incomplete

Properties contain media-related fields but the verified production WhatsApp send path is primarily text.

Required outcome:

verified media service plus typed outbound:

```text
text
image
video
document
location
```

---

## P1 — Migration/schema governance drift

Repository has duplicate numeric migration prefix `011`.

Do **not** rename historical migrations that may already be deployed.

Add future migrations from a new sequence.

---

# 8. EXISTING DATABASE FOUNDATION

Preserve useful existing tables including:

```text
organizations
users
devices
knowledge_bases
flows
team_members
agents
properties
contacts
conversations
baileys_sessions
messages
knowledge_chunks
bookings
lead_scores
nudge_jobs
handoff_events
lead_assignments
inventory_gaps
```

Useful existing columns include:

```text
agents.system_prompt
agents.temperature
agents.max_tokens

properties.ref
properties.ref_number
properties.source
properties.distress_deal
properties.image_urls

messages.wa_message_id

contacts.contact_memory

conversations.handled_by
conversations.assigned_to
```

Do not create duplicate entities where these can be safely extended.

Do not place unrelated configuration into one giant JSON field merely for convenience.

---

# 9. TARGET ARCHITECTURE

The target runtime should converge toward:

```text
Authenticated tenant
        ↓
Published tenant configuration
        ↓
Published AI agent version
        ↓
WhatsApp device/channel
        ↓
Durable inbound idempotency
        ↓
Unified conversation state
        ↓
Language + intent + entity extraction
        ↓
Deterministic/tool router
        ↓
Verified property / RAG / team / booking tools
        ↓
Controlled LLM generation where needed
        ↓
Response validation
        ↓
Outbound queue
        ↓
Baileys send
        ↓
Persistence + execution trace
```

The AI is not the database.

The AI does not create property truth.

The AI may interpret ambiguous language and compose responses, but business tools validate every authoritative action.

---

# 10. TARGET CONFIGURATION HIERARCHY

Use the effective hierarchy:

```text
Platform Safety Policy
        ↓
Product Agent Framework
        ↓
Tenant Organization Profile
        ↓
Published AI Agent Version
        ↓
WhatsApp Device / Channel Overrides
        ↓
Conversation State
        ↓
Contact / Lead Context
        ↓
Verified Property / RAG / Tool Context
```

Create one typed runtime resolver.

Recommended target abstraction:

```text
EffectiveAgentRuntimeConfig
```

It should resolve:

```text
organization profile
agent identity
published version
instructions
languages/style
property policy
handoff policy
model policy
allowed tools
knowledge bases
channel overrides
```

---

# 11. IMPLEMENTATION MIGRATION ORDER

Do not renumber historical migrations.

Add new migrations in this dependency order.

## 017 — Organization Profiles

Create:

```text
organization_profiles
```

Purpose:

move tenant/company identity out of source code.

Suggested fields:

```text
org_id PK/FK
legal_name
short_name
description
logo_url
office_address
map_url
website
email
phone
whatsapp
timezone
working_hours JSONB
service_areas TEXT[]
license_number
license_authority
social_links JSONB
company_facts JSONB
legal_disclaimer
approved_marketing_statements TEXT[]
created_at
updated_at
```

Backfill only verified tenant data.

Never copy IERE defaults into every organization.

---

## 018 — Agent Versions

Create:

```text
agent_versions
```

Keep existing:

```text
agents
```

as stable identity.

Add:

```text
agents.published_version_id
```

Suggested version fields:

```text
id
org_id
agent_id
version_number
status
config JSONB
parent_version_id
created_by
created_at
published_by
published_at
archived_at
```

Backfill every existing agent into an initial published version.

Keep legacy agent columns during compatibility.

---

## 019 — Agent Runtime Links

Create:

```text
agent_version_tools
agent_version_knowledge_bases
agent_channel_links
```

Use explicit org ownership.

Do not auto-link a device when multiple candidate agents exist.

---

## 020 — Agent Routing Rules

Create:

```text
agent_routing_rules
```

Move team routing out of source code.

Do not globally migrate hardcoded employee names.

Only migrate organization-specific hardcoded routing into the verified organization it belongs to.

---

## 021 — Unified Conversation State

Create:

```text
conversation_states
```

Recommended typed fields include:

```text
conversation_id
org_id
contact_id
language
intent
transaction_type
property_reference
project
building
area
property_type
bedrooms
min_budget
max_budget
property_status
developer
current_property_ref
shown_property_refs[]
rejected_property_refs[]
preferred_agent_id
qualification_state
handoff_state
state JSONB
schema_version
created_at
updated_at
```

Backfill from legacy memory carefully.

During compatibility:

```text
new state = primary
old stores = dual-write compatibility
```

Do not drop old memory immediately.

---

## 022 — Property Identity + Media

Use existing:

```text
properties.ref
properties.ref_number
```

Audit duplicates before adding uniqueness.

Create:

```text
property_media
```

Suggested media types:

```text
image
video
brochure
floor_plan
location
```

Backfill existing `properties.image_urls` where valid.

---

## 023 — Durable Message Idempotency

Use existing:

```text
messages.wa_message_id
```

Add as required:

```text
device_id
processing_status
processed_at
failure_code
```

After duplicate analysis, create appropriate uniqueness for:

```text
org_id + device_id + wa_message_id + direction
```

Do not invent synthetic historical WhatsApp message IDs.

---

## 024 — Handoff Lifecycle

Extend existing:

```text
handoff_events
conversations.handled_by
conversations.assigned_to
```

Add fields/state required for:

```text
requested
assigned
notified
accepted
active
escalated
resolved
cancelled/rejected
AI resumed
```

Do not invent historical timestamps.

---

## 025 — Knowledge Documents

Create:

```text
knowledge_documents
```

Link `knowledge_chunks` to documents/version where possible.

Preserve existing chunks/embeddings.

---

## 026 — AI Observability

Create:

```text
ai_execution_traces
ai_trace_tool_calls
ai_evaluation_runs
ai_evaluation_results
```

Protect PII.

Do not store secrets.

---

## 027 — Audit Logs

Create:

```text
audit_logs
```

for sensitive configuration and operational events.

Normal tenant APIs must not be able to rewrite history.

---

## 028 — Device Runtime Leases

Create:

```text
device_runtime_leases
```

Fields should support:

```text
device_id
org_id
owner_instance_id
lease_generation
leased_until
heartbeat_at
updated_at
```

`lease_generation` acts as the fencing token.

---

## 029 — RLS / Integrity Hardening

Run only after new tenant-owned tables exist.

Verify explicit policies for:

```text
SELECT
INSERT
UPDATE
DELETE
```

Remember:

backend service-role queries bypass RLS, so application org scoping remains mandatory.

---

# 12. IMPLEMENTATION PHASES

Implement in the exact dependency order below unless code inspection proves a necessary adjustment.

After every phase:

- run tests;
- produce a change report;
- state unresolved issues;
- state rollback point;
- STOP.

---

# PHASE 0 — BASELINE + SAFETY HARNESS
## Priority: P0

### Objective

Create a reproducible baseline before architectural changes.

### Required work

Inspect and record:

```text
root package.json
backend/package.json
frontend/package.json
migration history
runtime env requirements
existing routes
existing tests
current schema
```

Current audited scripts were:

## Root

```text
npm run dev
npm run dev:frontend
npm run dev:backend
npm run build
npm run start
npm run lint
npm run typecheck
npm run import:properties
```

## Backend

```text
npm run dev
npm run clean
npm run build
npm run start
npm run typecheck
npm run backfill:contact-memory
```

## Frontend

```text
npm run dev
npm run build
npm run start
npm run lint
npm run typecheck
npm run import:properties
```

Repository requirements found during audit:

```text
Node >=22 <23
npm >=10
```

### Add test tooling

Prefer:

```text
Vitest
React Testing Library
user-event
Supertest
Playwright
```

Create explicit scripts such as:

```text
test
test:unit
test:integration
test:tenant
test:ai-regression
test:e2e
test:all
```

Choose exact script implementation based on the repository.

### Initial verification commands

At minimum:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

Then new test scripts.

### Initial regression corpus

Add executable cases for:

```text
Hi
office address
2BR Dubai Marina under AED 2M
Send me property REF-123
Do you have another option?
Arabic property request
Connect me with an agent
duplicate inbound message
```

Known-broken cases may initially be explicit expected failures, but never hide them as passing.

### Acceptance

- clean dependency install;
- reproducible typecheck/build;
- executable test harness exists;
- baseline results documented;
- no production behavior intentionally changed.

### Rollback

Revert testing/tooling changes.

---

# PHASE 1 — TENANT SECURITY + AUTHORIZATION
## Priority: P0

### Objective

Eliminate arbitrary organization assignment and prove tenant isolation.

### Modify

```text
backend/src/api/middleware/auth.ts
backend/src/api/middleware/orgScope.ts

frontend/src/lib/authenticate.ts
frontend/src/app/api/auth/login/route.ts
```

### Required design

```text
Supabase authenticated user
→ explicit application membership
→ active organization membership
→ org context
```

No valid mapping:

```text
403 / onboarding required
```

Never:

```text
unknown user
→ first organization
```

### Service-role rule

Every service-role query involving tenant data must scope by server-resolved organization.

### Tests

Create Tenant A and Tenant B.

Attempt cross-tenant access to:

```text
agents
devices
properties
contacts
conversations
messages
knowledge
team
settings
```

Also test:

```text
forged orgId in body
forged orgId in query
unmapped authenticated user
disabled membership
```

### Acceptance

```text
cross-tenant reads = 0
cross-tenant writes = 0
arbitrary org fallback = 0
```

### Rollback

Revert middleware only.

Do not restore unsafe fallback as a long-term solution.

---

# PHASE 2 — TENANT COMPANY CONFIGURATION
## Priority: P0/P1

### Migration

```text
017_organization_profiles.sql
```

### Backend

Create:

```text
OrganizationProfileService
RuntimeConfigResolver foundation
```

Modify:

```text
backend/src/api/routes/settings.ts
backend/src/modules/ai/handlers/companyHandler.ts
```

Begin replacing:

```text
backend/src/config/companyData.ts
```

### Frontend

Enhance:

```text
frontend/src/components/pages/SettingsPage.tsx
frontend/src/components/layout/AppSidebar.tsx
```

Company profile UI must support:

```text
company/brand name
description
logo
address
map URL
phone
email
website
working hours
timezone
service areas
license data
social links
disclaimer
approved marketing statements
```

### Required test

Two organizations with different company profiles.

Ask the same company-info questions.

No tenant's name/address/phone/logo may appear in another tenant.

### Acceptance

Company-specific runtime facts no longer require source-code changes.

### Rollback

Compatibility fallback may temporarily remain only for the verified original organization while migration is validated.

It must never be used globally.

---

# PHASE 3 — VERSIONED AI AGENT CONTROL PLANE
## Priority: P1

### Migrations

```text
018_agent_versions.sql
019_agent_runtime_links.sql
```

### Backend

Create:

```text
backend/src/modules/config/RuntimeConfigResolver.ts
backend/src/modules/config/AgentVersionService.ts
```

Expand:

```text
backend/src/api/routes/agents.ts
```

Required API capabilities:

```text
GET    /api/v1/ai-agents
POST   /api/v1/ai-agents
GET    /api/v1/ai-agents/:id
PATCH  /api/v1/ai-agents/:id

GET    /api/v1/ai-agents/:id/draft
PATCH  /api/v1/ai-agents/:id/draft

POST   /api/v1/ai-agents/:id/validate
POST   /api/v1/ai-agents/:id/test
POST   /api/v1/ai-agents/:id/publish

GET    /api/v1/ai-agents/:id/versions
GET    /api/v1/ai-agents/:id/versions/:versionId
POST   /api/v1/ai-agents/:id/versions/:versionId/rollback
```

You may adapt endpoint naming to the existing route style, but do not create parallel duplicate APIs unnecessarily.

### Runtime

Published version, not source-code prompt, must become authoritative.

### Frontend foundation

Create:

```text
/ai-studio
/ai-studio/[id]
```

Do not complete the full AI Studio yet.

### Required tests

- Draft changes do not change live WhatsApp behavior.
- Publish atomically changes the active version.
- Historical versions are immutable.
- Rollback creates a new version based on an old version.
- Tenant A cannot read or publish Tenant B's agent.
- Concurrent stale publish returns a conflict rather than overwriting.

### Rollback

Keep legacy `agents` runtime fields during compatibility.

---

# PHASE 4 — PROPERTY + MEMORY CORRECTNESS
## Priority: P0

### Migrations

```text
021_conversation_state.sql
022_property_identity_and_media.sql
```

### Refactor

```text
backend/src/modules/ai/intentDetector.ts
backend/src/modules/ai/intentRouter.ts
backend/src/modules/ai/handlers/propertyHandler.ts
backend/src/properties/PropertyMatcher.ts
backend/src/modules/contacts/contactMemory.ts
```

### Create

```text
ConversationStateService.ts
PropertySearchCriteria.ts
PropertyMediaService.ts
StructuredIntentClassifier.ts
```

Use repository naming conventions when placing these files.

### Canonical property criteria

Support at least:

```text
referenceNumber
transactionType
propertyType
project
building
area
bedrooms
minPrice
maxPrice
status
developer
distressOnly
excludeRefs[]
```

Do not overload `category` with multiple meanings.

### Search order

```text
1 exact reference
2 exact project/building
3 exact structured constraints
4 ranked structured alternatives
5 policy-approved relaxation
6 clarification
7 honest no match
```

### Required conversation behavior

Example:

```text
User: I need a 2BR in Marina.
User: Max 2 million.
User: Show me more.
```

State must retain:

```text
area
bedrooms
budget
```

and exclude previously shown references.

### Arabic

Support structured extraction for Arabic and mixed English/Arabic.

### Required property tests

```text
exact property reference accuracy = 100%
cross-tenant property leakage = 0
unsupported property facts = 0
wrong exact-property substitution = 0
previous-property repetition when alternatives exist = 0
```

### Rollback

Keep old memory stores and matcher behind compatibility during validation.

Do not delete data.

---

# PHASE 5 — DURABLE MESSAGE IDEMPOTENCY
## Priority: P0

### Migration

```text
023_message_idempotency.sql
```

### Modify

```text
backend/src/whatsapp/MessageRouter.ts
backend/src/lib/messageDedup.ts
```

### Create

```text
MessageIdempotencyService.ts
OutboundMessageService.ts
```

### Eventually retire

```text
backend/src/utils/messageLock.ts
```

as correctness authority.

### Required behavior

Carry:

```text
message.key.id
```

into:

```text
messages.wa_message_id
```

and include device/org context.

### Required test

Replay one identical Baileys event:

```text
twice
10x concurrently
after backend restart
against two replicas
```

Expected every time:

```text
1 logical inbound
1 business execution
1 outbound response
```

### Rollback

New DB columns and uniqueness remain.

Old processing may temporarily be re-enabled only if necessary.

---

# PHASE 6 — TEAM ROUTING + REAL HUMAN HANDOFF
## Priority: P1

### Migrations

```text
020_agent_routing_rules.sql
024_handoff_lifecycle.sql
```

### Replace/refactor

```text
backend/src/modules/agents/teamRouter.ts
backend/src/modules/ai/agentResolver.ts
backend/src/modules/handoff/handoffService.ts
backend/src/services/agentAlert.ts
```

Create target responsibilities:

```text
TeamRoutingService
HandoffCoordinator
HumanNotificationService
```

### Remove

Hardcoded employee names/phones/area matrices from production routing.

### Handoff state

Support:

```text
AI_ACTIVE
→ HANDOFF_REQUESTED
→ ASSIGNED
→ WAITING_FOR_AGENT
→ HUMAN_ACTIVE
→ RESOLVED
→ optional AI_ACTIVE
```

Persist auditable events.

### Critical invariant

When conversation state is:

```text
HUMAN_ACTIVE
```

AI outbound generation is blocked.

### Tests

```text
explicit human request detection = 100%
AI messages while HUMAN_ACTIVE = 0
```

Also test:

```text
no available agent
notification failure
timeout
reassignment
after hours
agent inactive
backend restart during handoff
```

### Rollback

Keep `conversations.handled_by` compatibility during cutover.

---

# PHASE 7 — KNOWLEDGE DOCUMENT LIFECYCLE + RAG HARDENING
## Priority: P1

### Migration

```text
025_knowledge_documents.sql
```

### Keep and enhance

```text
backend/src/rag/HybridRAG.ts
backend/src/rag/EmbeddingService.ts
backend/src/rag/KnowledgeIngestion.ts
backend/src/queue/workers/EmbeddingWorker.ts
```

### Required capabilities

```text
upload
document record
parse
version
chunk
embed
index
reindex
disable
delete
failure status
provenance
```

Agent version determines allowed KBs.

### Multilingual

Improve Arabic/multilingual lexical strategy without weakening existing vector search.

### Prompt-injection safety

Retrieved documents are untrusted content, not system authority.

### Tests

- Tenant A retrieval never returns Tenant B data.
- Disabled/deleted documents disappear from future retrieval.
- Retrieval trace contains KB/document/version/chunk provenance.
- Malicious document instructions cannot override platform policy.

### Rollback

Existing chunks/embeddings remain intact.

---

# PHASE 8 — COMPLETE AI STUDIO
## Priority: P1

### Navigation

Add:

```text
AI Studio
```

Keep human staff under:

```text
Team
```

Current semantic conflict:

```text
/agents → human team
/agents/[id] → AI agent
```

must be resolved.

Compatibility:

```text
/agents
→ /team

/agents/[id]
→ /ai-studio/[id]
```

for one migration period where appropriate.

### Modify

```text
frontend/src/components/layout/AppSidebar.tsx
frontend/src/lib/store.ts
frontend/src/lib/page-routes.ts
frontend/src/components/pages/AgentsPage.tsx
frontend/src/components/routes/AgentDetailRoute.tsx
```

### Create

```text
frontend/src/app/(auth)/ai-studio/page.tsx
frontend/src/app/(auth)/ai-studio/[id]/page.tsx
frontend/src/app/(auth)/ai-studio/[id]/test/page.tsx
frontend/src/app/(auth)/ai-studio/[id]/versions/page.tsx
frontend/src/app/(auth)/ai-studio/[id]/traces/page.tsx
```

Adapt exact grouping/path to current App Router structure.

### AI Studio sections

```text
Overview
Identity
Instructions
Company Profile inheritance
Knowledge
Property Behavior
Tools
Human Handoff
Model
Channels
Test Playground
Versions
Activity
```

### Identity configuration

Support:

```text
agent name
display name
role
persona
avatar
description
default language
supported languages
tone
formality
response length
emoji style
sales style
conversation style
greeting behavior
```

### Instructions

Tenant administrator can edit:

```text
system instructions
business objectives
conversation rules
sales methodology
prohibited statements
escalation behavior
company policies
qualification strategy
property recommendation behavior
objection handling
follow-up rules
appointment rules
handoff rules
```

### Property policy

Support safe controls for:

```text
direct inventory
indirect inventory
distress deals
exact reference priority
max results
fuzzy matching
minimum match score
price relaxation
area alternatives
clarification rules
exclude previously shown
```

Safety rules such as "never invent unavailable inventory" are not tenant-disableable.

### Tools

Allow only approved platform tools:

```text
property.lookup
property.search
property.compare
property.send_media
knowledge.search
team.lookup
booking.create
handoff.create
contact.update
lead.qualify
calculator.roi
location.send
```

Do not allow tenant-provided arbitrary server code.

### Model configuration

Expose safe controls:

```text
provider preference
model
temperature
max output
quality preference
latency preference
cost preference
fallback policy
```

Never expose platform API keys.

### Test playground

Must use draft configuration and expose:

```text
User Message
Detected Language
Detected Intent
Extracted Entities
Conversation State
Tools Selected
Property Query
Retrieved Properties
Knowledge Sources
Agent Version
Model
Validation
Final Response
```

Default test mode must not send real WhatsApp messages or produce uncontrolled side effects.

### Publish

```text
Edit Draft
→ Validate
→ Run Mandatory Tests
→ Show Diff
→ Publish
→ atomically switch published version
→ invalidate cache
→ audit log
```

### Rollback

Do not mutate historical versions.

Restore old configuration as a new version and publish it.

### Arabic / RTL

Support real RTL layouts and Arabic playground behavior.

Keep technical values LTR where required:

```text
UUID
REF number
URL
phone
JSON
trace ID
model ID
```

### Accessibility

Require:

```text
keyboard navigation
visible focus
labels
dialog focus
semantic headings
contrast
non-color-only status
screen-reader errors
```

---

# PHASE 9 — OBSERVABILITY + AUDIT + AI EVALUATION
## Priority: P1/P2

### Migrations

```text
026_ai_observability.sql
027_audit_logs.sql
```

### Create

```text
ExecutionTraceService.ts
ModelGateway.ts
ResponseValidator.ts
```

### Extract/refactor

Move provider handling out of `aiService.ts`.

Preserve good existing content validation concepts but make them testable and centralized.

### Trace each turn

Capture appropriately:

```text
trace ID
tenant
device
agent
agent version
inbound message ID
language
intent
confidence
entities
memory before
tool calls
tool parameters
tool results
property IDs
KB sources
provider
model
latency
tokens
estimated cost
validation gates
fallback
handoff decision
failure reason
final result
memory after
```

Protect PII and secrets.

### UI

Create execution trace pages and:

```text
Why this reply?
```

for privileged Inbox users.

### AI evaluation corpus

Cover:

```text
greeting
company info
exact property
area search
budget
bedrooms
multi-constraint
no match
alternative
another option
show me more
rejection
agent info
handoff
booking
media
ROI
knowledge
Arabic
mixed Arabic/English
negative sentiment
prompt injection
duplicate inbound
```

### Acceptance

An authorized operator can answer:

```text
Why did this AI response happen?
```

from structured evidence.

---

# PHASE 10 — DISTRIBUTED BAILEYS + WORKER RELIABILITY
## Priority: P0 before horizontal scale / P1 production architecture

### Migration

```text
028_device_runtime_leases.sql
```

### Modify

```text
backend/src/whatsapp/BaileysManager.ts
backend/src/whatsapp/WhatsAppGateway.ts
backend/src/whatsapp/DBAuthState.ts
backend/src/queue/QueueManager.ts
backend/src/queue/workers/MessageWorker.ts
backend/src/queue/workers/EmbeddingWorker.ts
```

### Create

```text
backend/src/whatsapp/DeviceLeaseService.ts
```

### Ownership

```text
device
→ lease
→ one runtime owner
→ heartbeat
→ generation/fencing token
```

When a worker loses lease ownership, it must stop sending.

### Queue use

Use queues where they provide real value:

```text
outbound WhatsApp
notifications
document ingestion
embeddings
nudges
analytics
AI evaluations
cleanup
```

Do not queue every tiny synchronous lookup.

### Multi-replica test

Start Backend A and B against one device.

Expected:

```text
exactly one owner
```

Kill owner:

```text
controlled takeover
```

Restart stale owner:

```text
stale generation cannot send
```

### Acceptance

Simultaneous active ownership of one WhatsApp device:

```text
0
```

Duplicate customer replies during failover:

```text
0
```

---

# PHASE 11 — FINAL HARDENING + PRODUCTION VALIDATION
## Priority: Launch Gate

### Migration

```text
029_rls_integrity_hardening.sql
```

### Full RLS review

Verify every tenant-owned table.

Also test service-role application isolation independently.

### UX completion

Polish rather than rewrite:

```text
Dashboard
Inbox
Contacts
Pipeline
Properties
Team
Knowledge
Devices
Analytics
Settings
Activity Log
Onboarding
```

### Existing useful functionality must remain

Preserve unless proven broken:

```text
dashboard
shared inbox
contacts
pipeline
properties
direct/indirect inventory
agents
bookings
RAG
analytics
nudges
WhatsApp QR
flows
knowledge base
handoff
lead scoring
existing UI components
```

### Onboarding E2E

Prove a new customer can:

```text
register/login
→ create organization
→ enter company profile
→ create AI agent
→ configure instructions
→ upload knowledge
→ manage properties
→ add team
→ configure handoff
→ connect WhatsApp QR
→ test AI
→ publish
→ operate live
```

without developer source-code changes and without a separate deployment.

---

# 13. REQUIRED BACKEND RESPONSIBILITY CHANGES

Use this as a verified direction, but confirm the actual repository before editing.

## KEEP + HARDEN

```text
backend/src/whatsapp/DBAuthState.ts
backend/src/rag/HybridRAG.ts
backend/src/rag/EmbeddingService.ts
backend/src/properties/ComparisonEngine.ts
backend/src/properties/ROICalculator.ts
```

## KEEP CORE + MODIFY

```text
backend/src/whatsapp/BaileysManager.ts
backend/src/queue/QueueManager.ts
backend/src/queue/workers/EmbeddingWorker.ts
backend/src/api/middleware/orgScope.ts
```

## REFACTOR

```text
backend/src/modules/ai/aiService.ts
backend/src/modules/ai/intentDetector.ts
backend/src/modules/ai/intentRouter.ts
backend/src/modules/ai/handlers/propertyHandler.ts
backend/src/modules/ai/handlers/companyHandler.ts
backend/src/modules/ai/handlers/agentHandler.ts
backend/src/properties/PropertyMatcher.ts
backend/src/modules/contacts/contactMemory.ts
backend/src/modules/handoff/handoffService.ts
backend/src/services/agentAlert.ts
backend/src/whatsapp/MessageRouter.ts
backend/src/whatsapp/WhatsAppGateway.ts
backend/src/rag/KnowledgeIngestion.ts
backend/src/api/routes/agents.ts
backend/src/api/routes/settings.ts
```

## REPLACE LOGIC

```text
backend/src/modules/agents/teamRouter.ts
backend/src/modules/ai/agentResolver.ts
backend/src/modules/ai/promptBuilder.ts
backend/src/lib/messageDedup.ts
backend/src/queue/workers/MessageWorker.ts
```

## DELETE FROM PRODUCTION RUNTIME AFTER CUTOVER

```text
backend/src/config/companyData.ts
backend/src/utils/messageLock.ts
```

Do not delete them before equivalent tenant-aware functionality has been migrated and verified.

---

# 14. REQUIRED FRONTEND RESPONSIBILITY CHANGES

## KEEP + ENHANCE

```text
frontend/src/components/pages/InboxPage.tsx
frontend/src/components/pages/ContactsPage.tsx
frontend/src/components/pages/PipelinePage.tsx
frontend/src/components/pages/PropertiesPage.tsx
frontend/src/components/pages/AnalyticsPage.tsx
frontend/src/components/pages/KnowledgeBasePage.tsx
frontend/src/components/pages/DevicesPage.tsx
frontend/src/components/pages/SettingsPage.tsx
frontend/src/components/pages/SettingsHandoffPage.tsx
frontend/src/components/routes/KnowledgeBaseDetailRoute.tsx
frontend/src/components/routes/ContactDetailRoute.tsx
```

## MODIFY

```text
frontend/src/components/layout/AppSidebar.tsx
frontend/src/lib/store.ts
frontend/src/lib/page-routes.ts
```

## REFACTOR

```text
frontend/src/components/pages/AgentsPage.tsx
```

This page is currently human team management and should become clearly Team.

## REPLACE / COMPATIBILITY REDIRECT

```text
frontend/src/components/routes/AgentDetailRoute.tsx
```

AI configuration should move to AI Studio.

## CREATE

AI Studio, test playground, version history, publish/rollback, execution trace UI, and complete onboarding.

---

# 15. FRONTEND API RULE

The repository currently contains both:

```text
frontend Next.js API routes
and
backend /api/v1 routes
```

Do not maintain two independent implementations of business logic.

Target either:

```text
Browser
→ thin same-origin Next.js BFF
→ backend /api/v1
```

or direct authenticated backend calls if the repository architecture supports them safely.

Frontend API routes may remain as compatibility adapters.

They must not independently implement:

```text
AI orchestration
tenant authorization policy
property matching
handoff
agent versioning
```

---

# 16. PROPERTY TRUTH RULES

These are mandatory.

1. Exact property reference is checked before broad search.
2. Every returned property belongs to the authenticated tenant.
3. Every factual property field comes from verified data.
4. Property type must not be dropped during routing.
5. Budget/bedroom/location constraints must not be silently ignored.
6. Previously shown properties are excluded when the user asks for another option and alternatives exist.
7. Relaxation must be explicit and traceable.
8. A partial/fuzzy result must not be described as exact.
9. If no verified match exists, say so.
10. Never generate a fake property because the LLM wants to be helpful.

---

# 17. HUMAN HANDOFF RULES

A human handoff is a backend state transition, not a sentence.

The system must support:

```text
request
assignment
notification
acceptance
human-active
reassignment
escalation
resolution
AI resume
```

During `HUMAN_ACTIVE`:

```text
AI outbound response generation = blocked
```

The UI must reflect real backend state.

---

# 18. MESSAGE IDEMPOTENCY RULES

The same incoming WhatsApp message must never produce multiple logical executions.

Use:

```text
org_id
device_id
wa_message_id
```

as durable identity where valid.

Redis/process locks may optimize concurrency but may not be the sole correctness mechanism.

---

# 19. BAILEYS RULES

Preserve:

```text
QR flow
DB-backed auth/session
reconnect/self-heal concepts
```

Add:

```text
distributed device ownership
fencing
graceful ownership loss
media sends
delivery/failure observability
```

Do not deploy multiple competing owners for one session.

---

# 20. RAG RULES

Every search must be scoped to:

```text
org_id
+
allowed KB IDs
```

The published agent version determines allowed knowledge.

Add document/version provenance.

Treat retrieved text as data, not privileged instructions.

---

# 21. AI PROVIDER RULES

Centralize model calling behind a provider/model gateway.

Current audited backend behavior used Claude then Groq then deterministic fallback; the frontend had a separate Anthropic/Groq/OpenAI path.

Do not leave two production provider stacks with different behavior.

Model configuration may be tenant-selectable only within safe platform-approved options.

Secrets stay platform-side.

---

# 22. REQUIRED TEST STRATEGY

## Unit

Test deterministic business logic:

```text
property criteria
exact ref extraction
routing
conversation state merge
handoff transitions
tenant config resolution
response validation
```

## Integration

Test:

```text
database
migrations
APIs
RAG
queues
WhatsApp abstractions
agent publishing
handoff
```

## Tenant isolation

Deliberately attempt cross-tenant access.

## Property accuracy

Use deterministic fixtures.

Example:

```text
REF-A
Marina
2BR Apartment
SALE
AED 1.9M

REF-B
Marina
3BR Apartment
SALE
AED 2.8M

REF-C
JVC
2BR Villa
SALE
AED 1.7M
```

For:

```text
2BR apartment Marina under AED 2M
```

only REF-A may be an exact match.

## Conversation regression

Include:

```text
Hi
returning greeting
company info
exact property
area search
budget
bedrooms
multi-constraint
no match
another option
show me more
reject previous
human handoff
booking
media request
ROI
knowledge
Arabic
mixed EN/AR
angry user
prompt injection
unavailable property
duplicate inbound
```

## Arabic

Test full structured property requests, not only greetings.

## Baileys

Test:

```text
initial QR
expired QR
reconnect
network loss
restart
logout
bad credentials
session repair
disconnect
delete
multi-replica ownership
```

## UI

Test:

```text
desktop
laptop
tablet
mobile
RTL
accessibility
loading
empty
error
permission denied
conflict
```

---

# 23. REQUIRED QUALITY GATES

The following are release blockers.

| Gate | Required |
|---|---:|
| Cross-tenant data access | 0 |
| Unknown user assigned to arbitrary org | 0 |
| Wrong exact property | 0 |
| Unsupported/invented property fact | 0 |
| Duplicate response for same WhatsApp message ID | 0 |
| Simultaneous Baileys active ownership | 0 |
| AI reply while HUMAN_ACTIVE | 0 |
| Cross-tenant KB retrieval | 0 |
| Cross-tenant property media | 0 |
| Unauthorized AI publish | 0 |
| Migration data loss | 0 |
| Required regression failures | 0 |
| TypeScript build errors | 0 |
| Critical accessibility violations | 0 |
| Unresolved P0/P1 security findings | 0 |

Controlled evaluation targets:

```text
Exact property lookup                 100%
Explicit handoff detection            100%
General intent accuracy               >=98%
Structured property entity accuracy   >=98%
Tool selection accuracy               >=99%
Language consistency                  >=99%
Unsupported property facts            0
```

Do not weaken the test corpus simply to make metrics pass.

---

# 24. REQUIRED BUILD / VERIFY COMMANDS

Use the repository's actual scripts.

At minimum, after dependency installation:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

After Phase 0, also run the test scripts you add, such as:

```bash
npm run test:unit
npm run test:integration
npm run test:tenant
npm run test:ai-regression
npm run test:e2e
npm run test:all
```

If exact names differ, document the actual scripts you created and use them consistently.

Do not claim success if a required command was skipped.

---

# 25. DATABASE VERIFICATION

CI/release must test both:

```text
empty database
→ all migrations
```

and:

```text
representative old database
→ new migrations only
```

Verify:

```text
tables
columns
constraints
indexes
FKs
RLS
backfills
data preservation
```

Do not rename deployed migration history to clean up numbering.

---

# 26. SECURITY VERIFICATION

At minimum test:

```text
BOLA/IDOR
RLS bypass
service-role scoping
JWT manipulation
SQL injection
XSS
file upload
SSRF where relevant
prompt injection
RAG poisoning
secret leakage
rate-limit abuse
queue abuse
cross-tenant media
cross-tenant traces
cross-tenant agent/KB/device linking
```

A successful UI flow is not sufficient.

---

# 27. UX/UI REQUIREMENTS

Preserve the current product's strong visual foundation.

Do not replace the entire dashboard.

AI Studio and new pages must match existing:

```text
cards
sidebar
badges
tables
dialogs
sheets
typography
dark/light behavior
responsive shell
```

New UI must include:

```text
loading
empty
error
permission
validation
conflict
success
mobile
RTL
accessibility
```

Configuration changes must have clear saved/unsaved states.

Important validation failures must be visible inline, not toast-only.

---

# 28. TENANT SELF-SERVICE ACCEPTANCE CRITERIA

The completed system must satisfy all of the following:

1. A new company can register/onboard without developer code changes.
2. Each company can configure its own AI agent from the UI.
3. Each company can enter its own company information from the UI.
4. Each company can create/edit agent instructions from the UI.
5. Each company can upload its own knowledge.
6. Each company can manage its own properties.
7. Each company can manage its own human team.
8. Each company can connect its own WhatsApp through QR.
9. Each company can configure handoff rules.
10. AI configuration is tenant isolated.
11. Knowledge retrieval is tenant isolated.
12. Property retrieval is tenant isolated.
13. WhatsApp sessions are tenant isolated.
14. Conversations and contacts are tenant isolated.
15. A normal tenant requires no separate deployment.
16. AI never invents properties.
17. Exact property requests prioritize exact verified matches.
18. AI remembers relevant conversation requirements.
19. AI and humans cannot reply simultaneously after handoff.
20. Agent configuration supports versioning and rollback.
21. Tenant administrators can test AI changes before publication.
22. Developers/authorized admins can trace why an AI response happened.
23. Existing useful functionality is preserved.
24. The platform can scale beyond one real-estate company.

---

# 29. ROLLBACK STRATEGY

Every implementation phase must have a rollback point.

Use:

```text
additive DB migrations first
compatibility columns/tables
feature flags where useful
old runtime retained until new tests pass
published agent version history
previous application deployment
database backup/PITR
single-worker Baileys fallback
```

Do not drop legacy fields in the same release that first introduces their replacement.

Only perform destructive cleanup after:

```text
production validation
stable compatibility period
data reconciliation
rollback no longer depends on old field
```

---

# 30. DOCUMENTATION REQUIREMENTS

Update documentation as implementation progresses.

At minimum maintain:

```text
architecture overview
tenant resolution
runtime message flow
AI configuration hierarchy
property search contract
handoff state machine
Baileys ownership model
queue topology
RAG ingestion/retrieval
migration notes
environment variables
runbook
test commands
deployment checklist
rollback procedure
```

Historical documents must not continue claiming obsolete runtime behavior.

Mark superseded documents clearly.

---

# 31. REQUIRED PHASE REPORT FORMAT

At the end of every implementation phase, produce:

```text
PHASE X COMPLETE

1. Objective
2. Files changed
3. Files created
4. Migrations added/applied
5. APIs added/changed
6. UI added/changed
7. Runtime behavior changed
8. Tests added
9. Commands run
10. Test results
11. Security/tenant checks
12. Known limitations
13. Regression risk
14. Rollback point
15. Next phase dependencies
```

Then STOP.

Do not begin the next phase until explicitly authorized.

---

# 32. PROHIBITED SHORTCUTS

Do not:

- hardcode a new tenant into source;
- add tenant-specific fallback users;
- return static company data for missing configuration;
- create fake property examples in production responses;
- claim handoff succeeded when only text was sent;
- claim dedupe works because an in-memory Map exists;
- claim horizontal scalability while Baileys ownership is process-local;
- expose API secrets in AI Studio;
- bypass backend authorization because RLS exists;
- bypass RLS because backend uses service role;
- implement AI Studio without wiring it to runtime;
- keep duplicate production AI pipelines with inconsistent logic;
- store all future configuration in one giant untyped JSON object;
- silently overwrite published agent versions;
- overwrite another admin's draft without conflict handling;
- delete historical migrations;
- rename already-deployed migrations;
- make broad UI redesigns unrelated to the implementation goal.

---

# 33. FINAL PRODUCTION VALIDATION

Before any final production-ready claim, run and report:

```text
npm ci
npm run typecheck
npm run lint
npm run build
```

plus all added automated test suites.

Then validate:

```text
clean DB migration
upgrade DB migration
tenant isolation
exact property correctness
conversation memory
Arabic property behavior
another-option behavior
message dedupe
handoff
RAG isolation
AI publish/rollback
traceability
QR/reconnect
multi-replica Baileys ownership
property media
onboarding E2E
desktop/mobile/RTL/accessibility
load
failure recovery
security
staging smoke
```

No production-readiness statement is permitted while a P0/P1 blocker remains.

---

# 34. FINAL TARGET STATE

The intended architecture is:

```text
ONE SHARED MULTI-TENANT SAAS
        │
        ├── secure organization membership
        ├── tenant company profile
        ├── versioned AI agents
        ├── tenant knowledge
        ├── verified properties + media
        ├── human team + routing
        ├── WhatsApp device(s)
        └── tenant conversations
                 │
                 ▼
       durable inbound idempotency
                 │
         conversation state
                 │
        language / intent / entities
                 │
         deterministic tool router
        ┌────────┼─────────┬───────────┐
        │        │         │           │
 property    knowledge   team      booking/CRM
        │        │         │           │
        └────────┴────┬────┴───────────┘
                     │
             controlled LLM
                     │
             response validator
                     │
              outbound queue
                     │
                  Baileys
                     │
                 customer
                     │
             structured trace
```

The control plane is AI Studio.

The execution plane is the verified multi-tenant runtime.

Adding a normal customer requires configuration and data, not source-code changes and not a separate deployment.

---

# 35. START INSTRUCTION

When the user authorizes implementation, begin with:

**PHASE 0 — BASELINE + SAFETY HARNESS**

Do not jump directly to AI Studio.

Do not implement later phases early unless required strictly as a dependency.

At the end of Phase 0, produce the required phase report and stop.

