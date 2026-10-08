# Phase 4 — Property and conversation correctness

Only Phase 4 is implemented here. Phase 5 message idempotency and Phase 6 handoff lifecycle remain gated.

The backend owns classification, matching, state and media validation. Both browser chat and the WhatsApp router use that path. `PropertySearchCriteria` separates property type from sale/rent transaction type and supports exact reference, project, building, area, bedrooms, minimum/maximum price, status, developer, distress and exclusions. English, Arabic and mixed messages share extraction. Arbitrary names can be supplied explicitly as `area: …`, `project: …`, `building: …` and `developer: …`; known area aliases also work in ordinary messages. Unresolved locations produce clarification instead of guessed inventory.

An exact reference checks both existing aliases within the resolved organization. Unknown, unavailable and ambiguous references never substitute another property. Other searches preserve all requested constraints, exclude both aliases before limiting, rank eligible direct listings before partner listings, and report an honest no-match when exhausted. Default runtime policy allows no relaxation. The internal typed matcher accepts an explicitly approved maximum-price policy capped at 10%, reports `partial`, and records the relaxed field; chat request bodies cannot grant this policy.

`conversation_states` is authoritative when a conversation ID is supplied. The service verifies the conversation and contact, imports valid legacy criteria lazily, and saves through a transaction with revision compare-and-set. Concurrent losers reread state and search with updated exclusions before returning a result. Exact listing facts provide context for subsequent alternatives; detail/media requests retain the selected reference, while “more options” clears it and honors exclusions. Compound references are kept intact. This is state concurrency control, not inbound message deduplication. Both existing memory stores are dual-written in the same transaction; unrelated legacy values remain. Stateless calls can supply their current message but do not create durable state without a conversation ID.

Migration 022 audits existing identity conflicts without deleting or selecting a winner. A tenant lock rejects new conflicts across either alias, including concurrent inserts. Existing `ref` uniqueness remains; a global new unique constraint on dirty legacy aliases is intentionally avoided. Nullable project/developer fields are not inferred or backfilled. Owned media uses a composite property foreign key and server-only access. Eligible HTTPS image URLs are backfilled; current legacy URLs are also validated on read. Media requests return recorded links only. Binary WhatsApp attachment delivery is reserved for the later typed outbound/tool work.

The property workspace shows recorded type, project/developer and accessible media cards, with responsive layouts and explicit loading, missing-media and error states. Price/location/bedrooms/transaction/agent facts in assistant replies are deterministic and conditional on stored values. The existing ROI calculator remains an estimate interface and is outside the factual assistant formatter.

## Reproduce verification

Stop workspace development servers before `npm ci` on Windows; native modules cannot be replaced while loaded. Preserve their commands and restart them after verification. Do not run concurrent install/build jobs against this checkout.

```text
node scripts/phase4-verify.mjs
node scripts/phase4-files.mjs
```

The verifier records installation, application/test typechecks, lint, builds, all existing suites, strict gates and the combined database suite. A nonzero verifier exit retains inherited failures visibly. Results are copied only when produced by that command, avoiding stale evidence after a setup failure.

`npm run test:properties:db` uses the pinned `self-hosted/v0.8.2` DB/Auth/REST Docker harness. Names, loopback ports and credentials are generated; storage is disposable. Active SQL is replayed in deterministic filename order, including both 011 files and excluding `legacy/`. Replay errors fail the run. Populated upgrade fixtures check preservation, identity auditing and safe media backfill. Real authenticated requests exercise both applications; providers and WhatsApp are stubbed, non-local backend network requests are rejected, and Tenant B snapshots are compared after every case. Existing company/studio screenshots are redirected into this phase's evidence. No live environment files are accepted.

Historical phase evidence, manifests and SQL remain immutable. The pre-change archive and pinned source manifest are recorded in the completion report. The old matcher remains explicitly available as `LegacyPropertyMatcher` for compatibility/rollback validation; current callers use the canonical matcher. Restore the archive into a separate review directory and reinstall/build there. Do not delete new state/media data to roll back application code. A future production rollout needs its own database backup and schema/application release plan; this phase applies migrations only to disposable local databases.

See [completion report](PHASE_4_COMPLETION_REPORT.md), [verification](verification.json), [file comparison](file-changes.json) and [database evidence](database-evidence.json).
