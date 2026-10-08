# Phase 6 — Team routing and human handoff

This is the active handoff reference. Earlier phase documents remain immutable historical snapshots. Phase 5 still describes the transport admission and delivery protocol; its former handoff limitation is superseded here. The controlling scope is the Master Codex Implementation Prompt, verified against the repository rather than historical completion claims. Phase 7 is not implemented.

## Lifecycle and ownership

`AI_ACTIVE → HANDOFF_REQUESTED → ASSIGNED → WAITING_FOR_AGENT → HUMAN_ACTIVE → RESOLVED → optional AI_ACTIVE`

The authoritative state, revision, deadline and reason live on the tenant-owned conversation. Every lifecycle change appends a `handoff_events` record. Database transitions lock the conversation, validate its related tenant records, and synchronize `handled_by` for compatibility. Requested, assigned, waiting, human-active and resolved states use legacy `handled_by=human`; the detailed lifecycle distinguishes waiting from accepted ownership. Resuming AI requires an explicit action after resolution.

English and Arabic explicit human requests bypass providers. A business reply's existing handoff flag now starts the same durable lifecycle. An inbound WhatsApp receipt remains idempotent under Phase 5. The automatic assignment uses the conversation revision so concurrent request handlers cannot create duplicate assignments or notifications.

Routing uses only stored team records and tenant rules. Active, available members within their saved timezone/day/time schedule are eligible. Prioritized area/budget rules take precedence; stored budget tiers, area specialization, tenant default, least-busy selection and persisted round-robin history provide configured routing without fixed employee names, phones or VIP amounts. Disabling automatic assignment leaves the request queued for manual assignment. Missing configuration never selects another tenant or a static employee.

## AI fence

Manual requests and recovery read the persisted typed conversation area and maximum price before selecting a team member. This keeps routing context after a process restart instead of depending on a transient incoming request.

Both the real WhatsApp router and backend chat check ownership before generation. A second check discards a reply if human ownership was accepted during generation. A database insert trigger prevents saving AI outbound replies while `HUMAN_ACTIVE` or `RESOLVED`, and the durable send claim prevents delivering previously prepared AI replies in those states. An accepted conversation still records customer messages.

The send claim and acceptance lock the same conversation. Acceptance returns 409 while an AI transport send is in flight or its outcome needs review. After a confirmed send completes, acceptance can proceed. These are application/database guarantees; they do not claim control over an external message already accepted by WhatsApp. Resolving and explicitly resuming AI is a separate operator decision.

## Notifications and recovery

Each assignment commits one `handoff_notifications` outbox row before a gateway call. The notification is sent to the assigned tenant member through the existing tenant-owned WhatsApp channel. It contains a conversation reference and an inbox instruction, rather than logging client messages or phone numbers. Competing processes claim each queued notification once.

Known invalid notification context is recorded as failed. A failed or interrupted network outcome remains unknown/sending and is never automatically resent. The workspace surfaces delivery review, and the request remains available even if notification fails. Reassignment creates another auditable assignment and notification; check the earlier delivery before deliberately notifying again.

Recovery starts after gateway bootstrap and runs every 30 seconds. Queued assignments recover after a restart. Expired or inactive/unavailable assignments return to requested and seek another eligible member. If none is eligible, they stay queued. `settings.handoff.sla.agentAcceptSeconds` sets the assignment deadline (default 120 seconds, database bounded). Existing free-form escalation descriptions and additional SLA targets remain saved preferences rather than new executable policy.

## APIs and UI

Backend `/api/v1/handoffs` and frontend `/api/handoffs` expose the queue and tenant-owned conversation details. `POST /:conversationId` accepts request, assign, accept, resolve and resume actions. Viewers cannot access handoff operations. An ordinary member can accept only their own assignment; owners, administrators and operators can accept as part of team operations. Routing rule creation/deletion and team availability/hours changes require an owner or administrator.

`GET /routing`, `POST /routing`, `DELETE /routing/:id` manage ordered routing rules. `PATCH /team/:id/availability` saves availability and optional timezone/day/time hours. Server-resolved organization context always overrides client organization fields. Foreign conversation/member/rule IDs return 404. Private routing/outbox tables and lifecycle RPCs reject authenticated/anonymous Supabase REST access.

The calm SaaS workspace on Settings / Handoff includes a queue, explicit ownership controls, deadline, notification warning, expandable audit history, team availability and working hours, and area routing. Inbox controls use the same backend lifecycle. Compatibility conversation updates return `409 HANDOFF_ACTION_REQUIRED` for ownership changes, and creating a human-owned conversation requires creating it first and then requesting a handoff. The administrative reset endpoint records resolve/resume transitions. Existing generic status and unread operations remain available.

## Migration and local verification

Migration 020 already belongs to the prior runtime configuration work. Historical SQL is unchanged. Phase 6 adds `024_agent_routing_rules.sql` and `025_handoff_lifecycle.sql`; the next migration number is 026.

The lifecycle migration imports legacy `handled_by=human` into `HUMAN_ACTIVE`, preserves its assignment and other business fields, and records a cutover audit for valid parent links. Existing update triggers may advance the conversation timestamp during import. No historical message ID, employee or organization mapping is invented.

`npm run test:handoffs:db` uses pinned `self-hosted/v0.8.2` Docker database/Auth/REST services, generated local credentials, loopback ports, isolated names and temporary storage. It refuses live environment files, replays every active numeric SQL file in filename order including both 011 files, excludes `legacy/`, fails visibly on replay errors, and removes its own containers/volumes. Populated fixtures verify earlier upgrades and the new human-state cutover. Providers and WhatsApp are stubbed; HTTP, Auth, SQL and browser applications are real.

`node scripts/phase6-verify.mjs` runs clean installation, application/test typechecks, lint, builds, all ordinary suites, both strict gates, browser checks and the combined database suite. `node scripts/phase6-evidence.mjs` promotes complete sanitized evidence only after the combined gate passes. `node scripts/phase6-files.mjs` verifies the rollback archive and unchanged historical evidence/SQL.

## Operator and rollback procedure

1. This phase applies migrations only to disposable local stacks. Before a future deployment, take a database backup, review the cutover audit and apply 024 then 025 before releasing the new application.
2. Confirm tenant team records, availability, working hours, routing defaults and usable notification phones. Pending requests are visible without successful WhatsApp notification.
3. Request, assign and accept in the handoff workspace. Acceptance pauses AI; human replies still use the existing message transport. Resolve when finished; resume AI only when intended.
4. Review failed/unknown/sending notifications and uncertain AI sends against actual transport receipts. Do not reset claims or automatically replay an unknown delivery. The Phase 5 transport runbook describes reconciliation using exact organization/device/message context.
5. To roll back application code, verify the archive hash in `checkpoint.json`, extract it into a separate review directory, and restore the pre-edit application files. Keep additive tables/columns, audit history, notification claims and the synchronized `handled_by` values. Do not automatically replay pending messages or roll back the database by dropping these records. The older application lacks the new AI fence; resuming it against accepted conversations requires an explicit operational cutover.
6. The completion report records command results, inherited failures and the precise archive/hash. Stop before Phase 7.
