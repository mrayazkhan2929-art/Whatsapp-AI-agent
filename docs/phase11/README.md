# Phase 11 local validation and review

The controlling Master prompt calls for final security, UX and launch validation. The user authorized local testing and will perform live acceptance personally. No staging deployment, production migration or physical WhatsApp connection is included. See [PHASE_11_COMPLETION_REPORT.md](PHASE_11_COMPLETION_REPORT.md) for the final 15-field report and [verification.json](verification.json) for executed gates. Historical reports and manifests remain immutable.

## Repeat automated verification

Use Node 22 and npm 10, with Docker running. From the repository root run `node scripts/phase11-verify.mjs`. This performs clean installation, application/test typechecks, lint, both builds, ordinary/strict/browser suites and the full database regression. It collects failures visibly. The database harness refuses real environment files, generates its own credentials and random loopback ports, and removes its own Docker project in `finally`. It never modifies the existing IERE Docker containers.

`npm run test:hardening:db` runs the same full database gate. The pinned Supabase `self-hosted/v0.8.2` bootstrap, PostgreSQL/Auth/REST images, Redis and local Mailpit SMTP are recorded in sanitized database evidence. Both 011 SQL files are included, `legacy/` excluded, replay errors fail, and pre-031 historical rows are fingerprinted before and after the additive migration.

## Open a local review workspace

Run `node scripts/phase11-db.mjs tests/tenant-db/final-hardening.test.ts --manual-review`. After the local acceptance checks finish, the fixture applications remain available. Read the loopback frontend and mailbox URLs, plus the disposable fixture login, from `test-results/phase11-local-review.json`. The frontend port is random to avoid collisions. This file contains only disposable local test credentials and is excluded from promoted phase evidence.

Open the frontend URL and sign in using that fixture account, or create another company using the normal registration form. Mailpit captures confirmation emails locally. SMTP sends no external mail. Complete your company, assistant, instructions, knowledge upload, inventory, team and handoff settings; use the QR dialog, Playground, release checks, publication, channel assignment and Inbox. Outbound WhatsApp, LLM and embeddings are fixture stubs; a rendered QR in this mode cannot pair a real phone. The automated workflow simulates phone scanning by updating only its own disposable device fixture. Rate limiting is tested separately, and is bypassed in this large fixture acceptance flow.

Stop this review with `node scripts/phase11-stop.mjs`. The helper closes its applications and removes its isolated Docker containers, volumes and network. Review data is disposable. The review helper also shuts down automatically after 11.5 hours; sign in again if your one-hour user session expires. Do not use this mode for real customer data or real provider credentials.

## Your live acceptance checklist

After configuring your own authorized non-production environment and taking a recoverable database snapshot, apply the complete active chain in deterministic order. Keep service keys and the WhatsApp encryption key server-side. Drain older replicas before schema/application rollout and retain the existing encryption key. Configure Supabase Auth sign-up, email confirmation, SMTP and allowed redirects; this local check does not establish your hosted Auth configuration.

Register a fresh disposable customer, confirm email, create a company, and complete every onboarding step. Upload a real supported document, link it to the assistant, run deterministic checks and an AI preview, publish, assign a device, and scan a real QR. Send an exact property request in English and Arabic from another phone. Verify one correct reply, tenant-scoped trace, knowledge citations, human handoff, first-message progress and the Inbox. Check duplicate webhook/message handling, reconnect after restart, runtime takeover and uncertain-send handling. Verify desktop, phone and keyboard interaction in your target browser. Check the second tenant remains unchanged. Record real provider latency/errors, sustained load, SMTP, Realtime, QR/session reuse and delivery receipts. These checks remain UNVERIFIED until performed against that environment.

## Schema and authorization changes

031 enables RLS on every application table, removes broad historical browser policies and grants, and reserves table writes and application RPCs for the authorized server. Authenticated browser reads are limited to conversations/messages for Realtime, with canonical membership and validated contact/device/team parent ownership. Existing malformed historic links are retained but hidden; new cross-tenant UUID parents and org changes are rejected by triggers. Canonical membership ignores metadata and client organization IDs. Direct membership wins, including a disabled mapping; the confirmed unique-email fallback is allowed only when no direct mapping exists.

Explicit confirmed-user onboarding is separate from login and membership resolution. A service-only transaction creates one organization and owner after checking for any existing ID/email membership and locking concurrent identity/email attempts. Denied authentication never creates mappings. API cookies are issued only after authorization succeeds. Read-only viewers cannot mutate; owner/admin configuration permissions and mutation origin checks are enforced by both applications.

## Dependency and compatibility evidence

Compatible dependency updates remove the recorded critical production advisories. Eight dependency advisories remain: five high development-tool findings through Next ESLint / fast-glob / micromatch / braces, and three moderate production dependency entries through Mammoth / argparse / sprintf-js. The affected sprintf input parser is in Mammoth's CLI; the application uses its document conversion API. These observations limit the known exposed paths but do not prove the dependencies safe. Do not force the audit's incompatible downgrade suggestions. Both full and production audit JSON are retained. A real Signal prekey encryption and bidirectional ratchet roundtrip checks the patched protobuf dependency used by Baileys. Physical WhatsApp compatibility still requires your live test.

## Rollback

Verify `checkpoint.json` and its pre-edit ZIP SHA256 before recovery. Extract into a separate directory, compare later user edits, then restore only the intended source. No live database rollback is required for this local phase. A future database rollback must restore a known database snapshot or use reviewed forward fixes; restoring old broad browser grants would reopen the exposure. Do not drop runtime/agent/knowledge tables or replay uncertainty as unsent. Stop all replicas, preserve delivery evidence, and avoid mixing pre-fencing and fenced binaries. Original SQL and all Phase 0-10 evidence remain unchanged.
