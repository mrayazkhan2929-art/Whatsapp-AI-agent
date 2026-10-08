# Phase 8 — AI Studio runbook

The Master Codex Implementation Prompt defines the phase; repository code and executed verification establish current behavior. Read `PHASE_8_COMPLETION_REPORT.md` for results, limitations and rollback details. Phase 0–7 reports remain historical checkpoints and have not been rewritten.

## Workspace and release

Human staff live at `/team`. `/agents` redirects there; `/agents/[id]` redirects to `/ai-studio/[id]`. AI Studio has an assistant list, configuration workspace, dedicated `/test`, `/versions` and `/traces` pages. The frontend API compatibility namespace remains `/api/agents`; backend routes remain `/api/v1/agents`.

Owners and administrators can edit configuration, run draft tests and manage channels. Viewers can read owned configuration/history but cannot edit or run tests. Identity, business guidance, allowed knowledge bases, property controls, approved tools, handoff and model preferences are saved as one revision. Company Profile is inherited authoritatively, with a link to its existing settings workspace.

Save the draft before testing it. Validate, run mandatory checks, review the displayed difference and publish. The existing revision/published-pointer conflict guard remains authoritative; stale changes return 409. Publication atomically creates an immutable version and switches the active pointer. Runtime resolution reads that pointer for each reply. An already running reply can finish with its earlier configuration. Restore a historical version through the version panel: restoration creates and publishes a new version rather than modifying history. Legacy snapshots keep their original shape; editing them in the expanded UI explicitly upgrades the draft to `studioVersion: 1`.

## Safe configuration

Only the twelve platform tool identifiers in `AgentStudioPolicy.ts` are accepted. These permissions cannot run tenant-supplied code. The UI distinguishes simulated actions from read-only retrieval in the playground. This phase does not add an automatic booking/contact/ROI/location tool dispatcher.

Exact reference priority remains mandatory. Maximum property results are 1–20, price relaxation is 0–10%, minimum fuzzy score is 0.7–1 and alternate areas are bounded. Fuzzy matching applies only to area names after exact matching fails; exact property identifiers are never substituted. Tenant, availability, source, distress and remaining constraints still apply. Preferred handoff members must be active members of the same organization. Existing explicit human-request and accepted-handoff safety fences remain in force.

Provider preferences and the two model IDs already used by the repository are allowlisted. API keys are never configurable in Studio. Model preferences affect provider ordering within those existing providers; availability still depends on server configuration. `safe-response` prevents switching providers on failure; automatic preference and legacy settings retain existing fallback behavior.

## Draft playground

`POST /agents/:id/playground` accepts `{ expectedRevision, message, state?, mode? }`. Message length is bounded to 2,000 characters. `state` accepts only bounded property search criteria, not customer/conversation/device identifiers. Additional organization/version/knowledge-base fields cannot expand scope. `mode` defaults to `preview`; `model` is an explicit opt-in.

Preview uses the saved draft, current authoritative company facts, real tenant-scoped inventory and lexical knowledge from that draft's allowed bases. It does not invoke an AI provider, send WhatsApp messages, create bookings, edit contacts or write inventory gaps. Its isolated criteria can be reset. Knowledge chunks must belong to the current ready index of an enabled, nondeleted document, or remain eligible under the existing legacy-chunk policy. Known poisoned chunks are quarantined; provenance identifies the retained chunks. Draft search is lexical English/Arabic; published hybrid retrieval is unchanged.

Model mode may consume platform provider credits when live credentials exist. It uses the existing provider SDKs, approved model/temperature/token settings, a 15-second request timeout and no provider retries. Deterministic company/property/handoff and denied-tool paths remain controlled previews. No provider tool interface is supplied. Missing or failed providers return a generic 503. Local verification stubs all providers and WhatsApp delivery; no live call was made.

Results include language, intent, entities, isolated state, tool decisions, property query/results, knowledge provenance, draft revision/config checksum, model, validation, final response and side-effect counts. A saved test artifact contains a redacted summary, not the raw user message or compiled prompt. Final responses are bounded and keys, emails and international phone numbers are redacted; verified property prices remain readable. Redaction and known action-claim/injection patterns are finite safeguards, not universal natural-language detection.

`GET /agents/:id/traces` lists the latest 100 owned artifacts. Records are retained; this phase adds no automatic erasure or full production execution trace service. Activity shows configuration audit events. `DELETE /agents/:id/channels/:deviceId` unlinks only an owned matching channel and records an audit event. Existing endpoint response/auth/cookie envelopes remain.

The release test endpoint performs the existing six checks plus saved-draft English greeting, Arabic greeting, human request and injection fixtures. All checks must pass before the existing RPC marks the exact revision tested. The playground also checks revision again after execution to reject a concurrently changed draft.

## Local schema and verification

`027_agent_studio.sql` is additive. It expands the tool constraint, adds private playground artifacts, guards preferred-member ownership and supplies service-only draft search and channel unlink RPCs. Existing migrations and historical agent snapshots remain untouched. The next free migration number is 028. No live migration has been applied.

Run `npm ci` only when workspace test/application workers have exited. Then run `node scripts/phase8-verify.mjs` for installation, application/test typechecks, lint, build, all existing suite categories and the full database gate. The database harness refuses live `.env` files and uses isolated digest-pinned Supabase `self-hosted/v0.8.2` DB/Auth/REST containers, loopback ports, generated credentials and temporary storage. It replays all active SQL in deterministic numeric/filename order, including both 011 files and excluding `legacy/`. SQL errors fail visibly; populated upgrade fixtures check preservation.

`npm run test:studio:db` runs 377 cases across all eight database files. For an isolated Studio follow-up use `node scripts/phase8-db.mjs tests/tenant-db/studio-workspace.test.ts`; this is a 32-case subset, not the complete gate. Real application HTTP/Auth/REST and browser requests are used. Provider and WhatsApp effects are stubbed; nonlocal outbound requests are blocked.

After the full passing database gate, `node scripts/phase8-evidence.mjs` promotes only sanitized evidence. `node scripts/phase8-files.mjs` compares the workspace against the pre-edit archive and rejects historical SQL or Phase 0–7 evidence changes. `npx vitest run tests/unit/source-safety.test.ts` checks all eight preservation checkpoints against explicit phase allowlists. `verification.json`, `final-verification.json`, logs, `database-evidence.json`, `file-changes.json`, screenshots and environment restoration evidence accompany the completion report. Earlier failed development attempts are retained separately and are not passing evidence.

## Recovery

The verified pre-edit archive is recorded in `checkpoint.json`, outside this repository. Check its SHA-256 before using it. Extract into a new recovery directory and compare files; do not overwrite a working database or user edits wholesale. When expanded versions have been published, first restore a compatible legacy snapshot as a new published version using Studio and record the new pointer. The previous application does not understand all expanded settings.

Revert only the Phase 8 source files listed by the inventory, reinstall from the preserved lockfile and rebuild. Retain the additive schema, old/new version history, document indexes and audit/test artifacts; no destructive down migration is provided. If a database backup restoration is required, review later writes separately before restoring it. Phase 9 observability, model gateway extraction, evaluation and global trace/retention work remain deferred until authorized.
