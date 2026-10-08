# PHASE 7 COMPLETE

Completed 7 October 2026. Scope: Knowledge Document Lifecycle and RAG Hardening. The Master Codex Implementation Prompt controls the upgrade; repository code and executed checks establish the implementation. Earlier reports remain historical reference. Phase 8 has not begun.

Completion has one inherited verification exception: repository lint exits 1 with three existing errors and one warning. Clean installation, application/test typechecks, build, ordinary and strict tests, browser checks and database suites pass. Dependency audit findings are separately recorded below.

## 1. Objective

Give knowledge documents a durable upload, parsing, versioning, chunking, embedding, indexing, reindexing, disable/delete and failure lifecycle. Restrict retrieval to the published agent's permitted knowledge bases, retain provenance, improve Arabic lexical retrieval and keep retrieved documents below platform policy authority. Preserve existing chunks and embeddings. Provide the requested modern, calm SaaS document workspace.

## 2. Files changed

The exact inventory is `file-changes.json`, compared against every entry of the verified pre-edit archive. Nineteen implementation files changed:

- Backend API registration and chat: `backend/src/api/app.ts`, `backend/src/api/routes/chat.ts`; startup recovery: `backend/src/index.ts`.
- AI runtime: `backend/src/modules/ai/aiService.ts`, `promptBuilder.ts`, `router.ts`.
- RAG: `backend/src/rag/KnowledgeIngestion.ts`, `EmbeddingService.ts`, `HybridRAG.ts`; queue compatibility: `backend/src/queue/workers/EmbeddingWorker.ts`.
- WhatsApp routing/provenance: `backend/src/whatsapp/MessageRouter.ts`, `OutboundMessageService.ts`.
- Frontend knowledge-base count API, `components/pages/KnowledgeBasePage.tsx`, `components/routes/KnowledgeBaseDetailRoute.tsx`.
- Backend and root package manifests, root lockfile, `tests/unit/source-safety.test.ts`.

Next.js regenerated `frontend/next-env.d.ts`, classified separately as generated output. No original file was removed and no environment configuration drift was detected. Historical Phase 0–6 evidence and existing SQL are unchanged. Existing dependency versions were preserved; parser dependencies were added.

## 3. Files created

- Backend `api/routes/knowledgeDocuments.ts`; frontend `app/api/knowledge/[[...path]]/route.ts` and `components/knowledge/KnowledgeWorkspace.tsx`.
- Migration `026_knowledge_documents.sql`.
- Unit `knowledge.test.ts`, `embedding-batch.test.ts`; database `knowledge-lifecycle.test.ts`; restart fixture `knowledge-replica.ts`; real PDF/DOCX parser fixtures; `vitest.phase7-db.config.ts`.
- Phase 7 database, verification, final database follow-up, evidence promotion and archive inventory scripts. Verification recovery helpers preserve earlier failed attempts separately.
- This report, current runbook, immutable checkpoint, explicit preservation allowlist, sanitized database/dependency/environment evidence, command logs and desktop/mobile/RTL screenshots under `docs/phase7/`.

The inventory lists each artifact. Temporary stack configuration containing generated local credentials is excluded from promoted evidence.

## 4. Migrations added/applied

`026_knowledge_documents.sql` adds private document/version/provenance tables, durable version claims, atomic index publication, ownership/immutability guards, bounded admission, multilingual lexical indexes and governed retrieval RPCs. Tenant-level advisory locking makes the pending-version limit hold across concurrent uploads to different knowledge bases.

The prompt's proposed number 025 is occupied by the active Phase 6 handoff migration. This additive migration uses the next available number **026**; the next available number is **027**. No historical SQL was edited.

Applied only in disposable Docker stacks. All 27 active SQL files from 001 through 026 replayed in deterministic numeric/filename order, including both 011 files; `legacy/` was excluded. Errors fail visibly. Populated fixtures verify exact preservation of historical chunk IDs, content, metadata, timestamps and vectors. Malformed historical tenant links remain stored but cannot participate in retrieval. Earlier populated upgrade fixtures also pass. No live project or user Docker database received a migration.

## 5. APIs added/changed

Backend `/api/v1/knowledge`, forwarded by frontend `/api/knowledge`, provides document list, binary upload, replacement upload, paged version history, reindex, enable/disable, soft-delete and published-agent retrieval preview. The runbook lists each route and envelope.

Authoritative server organization context governs every document, version, knowledge-base and agent lookup. Foreign IDs return 404; input/size failures return 400/413; unavailable published preview context returns 409; database failures remain 500. Viewers read and preview but cannot mutate. Client organization/knowledge/version fields cannot expand preview scope. Existing knowledge-base CRUD envelopes remain; chunk counts now count actual retained chunks. Chat returns retrieval provenance.

## 6. UI added/changed

Knowledge Base and detail pages now use a responsive workspace with subtle teal accents, working knowledge-base creation, file validation/upload, replacement targeting, indexing/failure state, prior-index visibility, enable/disable, reindex, deletion confirmation, paged history and governed retrieval preview. Loading, empty, unsaved selection, read-only and API error states are explicit. Document lists have bounded scrolling.

Real browser checks exercised upload, lifecycle actions and preview at desktop 1440px, mobile 390px and Arabic RTL 1100px; viewer controls were also checked. Document actions stack below their details on mobile, with a geometry assertion preventing squeezed titles. Geometry measurements and visually reviewed screenshots are in `artifacts/knowledge/`. Earlier application browser cases also pass.

## 7. Runtime behavior changed

Source bytes and checksum persist before parsing or provider calls. Queued/parsing/embedding/ready/failed versions use ten-minute claim leases and fenced commits. Recovery runs at startup and every 30 seconds, with up to ten eligible jobs per sweep and three claimed attempts. Concurrent and restarted workers cannot commit duplicate indexes; uncertain provider calls can still repeat billing after a crash.

PDF, DOCX, TXT, Markdown and JSON parsing is bounded. A chunk batch embeds once per indexing attempt; missing/failed/malformed provider results fail visibly rather than producing zero vectors. Chunks and the current-version pointer publish atomically. Older completion cannot replace a newer published index. Failed replacements keep the last successful index. Reindex retains source/history; disable and soft-delete immediately exclude future retrieval. Deleted pending records do not occupy the 100-job admission limit. Version history is capped at 1,000 versions per document.

Retrieval verifies the active published agent snapshot and immutable allowed knowledge links both before provider work and in SQL. Vector cosine search remains alongside English stemming and normalized Arabic/multilingual lexical search, merged by reciprocal rank fusion. Provider failure allows explicitly degraded lexical fallback. Static FAQ fallback facts were removed.

Known malicious instruction patterns are quarantined. Retrieved excerpts are JSON data in a separate user message, never system prompt authority. Provenance identifies KB/document/version/chunk without retaining excerpt bodies in traces; chat and outbound message metadata retain it. Property/contact memory is not populated with retrieval trace data.

## 8. Tests added

Twenty-one knowledge unit tests cover real PDF/DOCX extraction, UTF-8/JSON validation, parser/chunk bounds, Arabic normalization, malicious fixtures, hybrid fusion and provenance/system-authority separation. Eight embedding tests cover ordered batches, missing credentials, provider failure, malformed vectors, multi-batch limits and empty batches. Preservation adds the Phase 6 checkpoint with an explicit Phase 7 allowlist.

The 61 knowledge database cases cover both authenticated applications, tenant/role/forged-context denial, lifecycle failures and replacement history, real binary parser uploads, disabled/deleted visibility, published scope, Arabic/English retrieval, provider fallback, provenance and prompt boundaries, poisoned chunks, private REST/RPC denial, legacy preservation, concurrent/stale claims, actual worker restarts, out-of-order completion, queue capacity and concurrent admission, paged history, and four real browser cases. Exact Tenant B snapshots cover 11 relevant tables after each case.

## 9. Commands run

`node scripts/phase7-reverify.mjs` ran the complete clean verification orchestrator after prior workers finished. `verification.json` records:

- `npm ci`: exit 0; application and test typechecks: exit 0 each.
- `npm run lint`: exit 1, inherited findings; `npm run build`: exit 0.
- Unit, integration, tenant, strict tenant, AI regression, baseline browser, all-tests and strict ordinary commands: exit 0 each.
- `npm run test:knowledge:db`: exit 0, all seven database files.

`node scripts/phase7-final-db.mjs` then ran `node scripts/phase7-db.mjs tests/tenant-db/knowledge-lifecycle.test.ts` against the exact final SQL, including tenant-wide concurrent queue admission. `final-sql-verification.json` preserves that passing 61-case subset. After visual review identified squeezed mobile document details, `node scripts/phase7-ui-verify.mjs` repeated application/test typechecks, lint, build, all-tests, strict tests and the same 61-case database/browser subset. `ui-verification.json` and `final-verification.json` record the final application verification. Evidence promotion, archive comparison and final source-preservation checks were run after documentation.

Development corrections are retained separately: PDF parser compatibility, PostgREST FK disambiguation, deferred migration events, SQL alias collision, a missing test separator and generated-file allowlisting. An install attempted while test workers had Windows files open failed; workers were allowed to exit and the complete clean gate was rerun successfully. A proposed transitive dependency patch was unavailable and its override was removed. Earlier failed attempts are not represented as passing verification.

## 10. Test results

- Ordinary: **220 PASS, 0 FAIL, 0 XFAIL**, no module errors. Unit 159; integration 18; tenant 35; other ordinary coverage accounts for eight. AI regression 23 overlaps these suites.
- Strict ordinary: 220 PASS; strict tenant: 35 PASS. Baseline browser: four PASS.
- Combined real database gate: **345 PASS, 0 FAIL** — tenant 76, company 41, agent 44, property 52, transport 28, handoff 43, knowledge 61. Seventeen real application browser cases are included in this total.
- Final knowledge follow-up: **61 PASS, 0 FAIL** on final migration SQL, the extended concurrency assertion and final mobile layout. This repeats a subset and is not 61 additional unique tests. The combined run preceded the final tenant advisory-lock and mobile-layout refinements; both results are preserved explicitly. Final all-tests/strict repeats retain 220 ordinary passes and four baseline browser passes.

Lint remains three inherited `react-hooks/set-state-in-effect` errors in unchanged `EmbeddedSaaSFrame.tsx`, `ConversationList.tsx`, `MessageInput.tsx`, and one unused-disable warning in unchanged `LoginPage.tsx`. No strict-test failure remains.

Clean installation reports 49 audit entries: five critical, 23 high, 17 moderate and four low. The previous 46 entries are inherited. Three new moderate entries share the `sprintf-js` precision-formatting DoS advisory through the DOCX package's unused CLI dependency chain (`mammoth → argparse → sprintf-js`). The implemented raw-text extraction path does not invoke that CLI. No published fixed version was available during verification; this finding remains open. `dependency-audit.json` records the distinction; no existing dependency version changed.

## 11. Security/tenant checks

Tenant A retrieval never returned Tenant B data in tested attacks. Tenant B snapshots remained exact across all 61 knowledge cases, including forged bodies/query context and malformed stored links. Server and SQL validate published agent/version/KB ownership independently. Disabled/deleted documents, superseded chunks and invalid legacy links were excluded. Anonymous/authenticated REST cannot operate private indexing tables/functions or mutate raw chunks. Viewers cannot modify documents.

Known malicious English/Arabic document fixtures could not become system authority; quarantined chunks appeared only by ID in trace. Authorization and tool boundaries remain independent of model output. Finite fixtures do not establish perfect natural-language injection detection.

Local Auth, REST, HTTP, database, parsers, browsers and restarted workers were real. Embedding/AI/provider/WhatsApp calls were stubbed and nonlocal outbound requests blocked. The digest-pinned `self-hosted/v0.8.2` stacks used isolated names, loopback ports, temporary volumes and generated credentials. Their resources were cleaned up; existing user containers retained their IDs/start times. Development applications were initially stopped and remain stopped. Environment evidence records these checks.

## 12. Known limitations

- Local-only verification; no live deployment, migration, provider embedding or WhatsApp delivery test.
- No OCR or separate OS parser sandbox. Uploads are limited to 2 MB, DOCX declared expansion to 8 MB/500 entries, PDFs to 200 pages, and indexing to 200 bounded chunks. Large legacy reindexes fail visibly rather than discarding their old index.
- First 100 documents are listed per knowledge base; version history is paged 20 at a time. A document supports up to 1,000 versions and a tenant up to 100 nondeleted pending versions.
- Soft deletion retains source/history for recovery. Privacy erasure and retention policy are separate work.
- Provider crash uncertainty can repeat an embedding request; claim fencing prevents duplicate index commits, not duplicate external charges. Missing provider infrastructure fails indexing; retrieval can degrade to lexical coverage.
- Prompt-boundary controls and tested quarantine patterns cannot guarantee classification of every possible instruction attack.
- Inherited lint/audit findings and the new unused CLI-chain moderate advisory remain as documented.

## 13. Regression risk

Legacy chunks are preserved but retrieval now requires a valid document/current-version relationship and published permitted KBs. Missing or malformed associations can reduce retrieval; the UI exposes index state and preview. Parser dependencies add deployment footprint. Recovery requires the migration to precede the application. Source retention increases database storage; configured bounds limit each operation. No Phase 8 studio feature was implemented.

Earlier tenant, company, agent, property/memory, transport and handoff database suites were replayed, with their populated upgrades and browser coverage. This establishes tested compatibility rather than an unrestricted production guarantee.

## 14. Rollback point

Pre-edit archive: `F:\Whatsapp AI Conversation Agent\WA-bot-upgrade-v4\phase7-pre-change-20261007-170509.zip`, containing 926 files.

SHA-256: `A053D27C08F2F4529B1A700486529EF04B9D68F96520BCEAEEEC0DDE2D376CDE`.

Phase 7 manifest SHA-256: `5C2DC432DA5D602C1C30E32C9AE2DAA927B1F2D826419A051327D55AF4E73C39`. Immutable Phase 0 manifest remains `26012520EA88C51DE89B84BD2B27A3F82D92AD1B435FBC8C342B665DEC4D5850`.

Verify hashes and extract into a separate review directory before restoring application files. Preserve additive schema, original chunks/vectors and new source/history. Do not run a destructive down migration. Older RAG code does not enforce document disable/delete/current-version state; reverting it requires an explicit operational decision about knowledge visibility. Review the runbook before any future production rollout or rollback. No live change needs reversing from this phase.

## 15. Next phase dependencies

Phase 8 is Complete AI Studio and requires explicit user authorization. It can consume published version knowledge bindings, document status/history and governed preview APIs already implemented here. The next available migration is 027. Review recorded lint/audit findings and deployment prerequisites independently; no Phase 8 functionality or production rollout has begun.

**STOPPED after Phase 7.**
