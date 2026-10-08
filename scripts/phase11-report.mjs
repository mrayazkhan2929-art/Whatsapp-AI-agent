import {readFileSync,writeFileSync} from 'node:fs'
import {resolve} from 'node:path'
const root=resolve(import.meta.dirname,'..'),read=path=>JSON.parse(readFileSync(resolve(root,path),'utf8'))
const verification=read('docs/phase11/verification.json'),gate=verification.find(x=>x.command==='npm run test:hardening:db')
if(verification.length!==14||verification.some(x=>x.exitCode!==0)||gate.tests.passed!==492||gate.tests.failed)throw Error('Require every final gate passing')
const checkpoint=read('docs/phase11/checkpoint.json'),changes=read('docs/phase11/file-changes.json'),database=read('docs/phase11/database-evidence.json'),hardening=database.hardening,environment=read('docs/phase11/environment-restoration.json')
if(!environment.userContainerIdentitiesAndStartTimesUnchanged)throw Error('User container restoration missing')
const detail=x=>x.tests?`${x.tests.passed} passed, ${x.tests.failed} failed${x.tests.expectedFailures!==undefined?', '+x.tests.expectedFailures+' expected failures':''}`:x.e2e?`${x.e2e.expected} passed, ${x.e2e.unexpected} unexpected, ${x.e2e.skipped} skipped`:'passed'
const commands=verification.map(x=>`- \`${x.command}\`: exit ${x.exitCode}; ${detail(x)}; ${x.seconds}s. [Log](${x.log.replace('docs/phase11/','')})`).join('\n')
const report=`# Phase 11 local implementation and verification complete

8 October 2026, Dubai. **Live launch acceptance remains open.** The user chose "run local and i will test" in place of staging validation. The Master prompt controls the upgrade; repository code and executed checks establish current behavior. Historical reports remain immutable references. No staging/production deployment, live migration or physical WhatsApp connection was performed.

## 1. Objective

Finish tenant/RLS integrity, explicit customer onboarding, server-side permissions, UI polish and local regression validation. Preserve the existing inbox, contacts, pipeline, direct/indirect inventory, booking, agents, flows, nudges, knowledge, handoff, lead scoring, traces and distributed runtime.

## 2. Files changed

${changes.changed.length} existing paths are listed in [file-changes.json](file-changes.json). Changes cover dependency manifests/lockfile, middleware and auth routes; login, workspace navigation and shared styling; existing control labels; three inherited effect-related lint defects and additional hook compatibility repairs; test assertions and source preservation; root and migration READMEs. No original file was removed. Historical SQL, Phase 0-10 reports/artifacts and the original manifests remain unchanged. There is no environment configuration drift.

## 3. Files created

New identity middleware, frontend registration/onboarding endpoints, origin/redirect helpers, onboarding page and route; migration 031; security/request regression tests and database hardening suite; Phase 11 isolated database, verification, evidence, environment, file comparison, local shutdown and report helpers. The checkpoint, immutable manifest, allowlist, logs, sanitized inventories and browser artifacts are under this phase directory. Exact created paths, including generated evidence, are in the file inventory.

## 4. Migrations added/applied

One additive migration: **031_rls_integrity_hardening.sql**. Numbers 029/030 already contain active observability/audit and device reliability work, so 031 is the next available number. It enables RLS on all application tables, removes broad browser grants/policies, reserves writes and privileged RPCs for the server, validates tenant parents and prevents organization reassignment. Canonical membership drives the two authenticated Realtime read policies. Explicit onboarding uses a private transaction.

All **32 active SQL files**, including both 011 files, replay in deterministic filename order; legacy/ is excluded and errors fail visibly. The harness starts an empty disposable stack, loads historical fixtures at the appropriate upgrade boundaries, then fingerprints every existing public table before and after 031. Historical rows are preserved. This is local fresh bootstrap plus a populated pre-031 upgrade check, not a production database upgrade. No historical SQL is edited.

## 5. APIs added/changed

Backend POST /api/v1/auth/onboard validates the identity through Auth, requires confirmed email, and calls service-only onboard_organization. It locks email/identity attempts, rejects existing mappings, and creates one company and owner atomically. GET /api/v1/auth/onboarding returns eleven flags from saved tenant data. Frontend POST /api/auth/register handles sign-up or explicit confirmed-user workspace creation; GET /api/auth/onboarding proxies progress.

Existing /auth/me remains authoritative. Direct membership takes precedence; disabled direct mappings never fall through. Only a unique, active, confirmed-email match is allowed when no ID mapping exists. Metadata/client organization fields never choose a tenant. Login performs no mapping writes. Application cookies follow successful authorization only. Invalid identity, missing/inactive/ambiguous membership and infrastructure/lookup failures retain their existing 401/403/503/500 distinctions.

Viewer mutations are denied; configuration remains owner/admin controlled. Mutation origin checks protect both frontend handlers and proxies. Malformed frontend authentication JSON returns 400 before authentication or logging; backend malformed/oversize JSON returns controlled 400/413 responses, the framework fingerprint header is removed, and rate-counter admission is bounded with expiry recovery and retry timing. Successful response/cookie behavior is retained.

## 6. UI added/changed

A calm slate/emerald company-neutral login supports registration, confirmation and workspace creation. The new responsive onboarding workspace links to the real existing modules, polls saved progress, shows loading/error/read-only states and labels its controls. Shared surfaces receive restrained spacing, corners and accents; navigation removes fabricated badge counts. Skip navigation, reduced motion, named filters, checkboxes and icon controls improve existing pages. Device QR, knowledge upload, assistant review/publication and existing business workspaces remain in place.

Desktop/mobile onboarding screenshots were visually reviewed. Automated checks cover desktop, 390px mobile and RTL onboarding, plus all eleven listed existing workspaces. No critical Axe findings or recorded page errors remain in the exercised cases. Remaining noncritical contrast, heading-order and landmark findings are recorded; this is not a WCAG certification.

## 7. Runtime behavior changed

All application data writes and privileged reads use the authorized server. Only tenant-owned conversations/messages remain browser readable for Realtime, with validated contact, device and assigned-member parents. Legacy malformed rows remain stored but are hidden; new malformed parent links and tenant ownership moves fail before commit. Existing device fencing, durable transport, recovery, indexing, agent versioning and human ownership behavior are preserved.

New customers can authorize their own organization explicitly, then configure and publish without source edits or a separate deployment. Compatible dependency updates include Next 16.4.0, Baileys 6.7.24 and patched protobuf/sharp/qs/esbuild resolutions. Three source-unused frontend dependencies are removed. A real Signal prekey and bidirectional ratchet roundtrip verifies the protobuf override; physical transport compatibility still awaits live acceptance.

## 8. Tests added

Twenty ordinary cases above Phase 10: twelve redirect/role/Signal cases, seven origin/rate/malformed-auth cases and the eleventh preservation checkpoint. Seventeen new database cases audit public privileges and membership, reject direct REST/RPC writes and tenant moves, verify atomic onboarding and denied roles, exercise the complete UI customer flow, scan responsive/RTL/core workspaces and check forty concurrent reads plus forged JWT/CSRF attempts. Tenant B is compared after each case.

Older malformed-link fixtures are seeded through a privileged test-only transaction with the new guard temporarily disabled and constraints resolved before restoration. Production guards remain enabled. Older rejection assertions now expect the new explicit permission/parent rejection behavior; their no-write checks remain in place.

## 9. Commands run

Node **22.23.2**, npm **10.9.8**. Executed the complete collecting runner, repaired browser selectors and database assertion expectations, then refreshed affected application checks and reran the **entire** database gate. Superseded results are preserved separately and are not counted as passing final evidence. Exact latest commands/results are in [verification.json](verification.json).

${commands}

Additional source/archive, environment and evidence promotion commands are recorded in final-verification.json. Full and production npm audit both exit 1 because advisories remain; npm ls for the dependency overrides exits 0. Audit JSON and the dependency tree are retained.

## 10. Test results

Final ordinary/strict: **311 PASS, 0 FAIL, 0 XFAIL**, zero module errors; unit 250, integration 18, tenant 35 and other ordinary coverage eight. The AI regression command passes 23 overlapping cases. Standalone desktop/mobile browser smoke: **4 PASS**, zero skipped/unexpected/flaky.

Complete database gate: **492 PASS, 0 FAIL** across eleven files: tenant 76, company 41, agents 44, property/state 52, transport 28, handoff 43, knowledge 61, Studio 32, observability 56, reliability 42 and final hardening 17. Existing 27 browser cases plus seven new real-application browser cases are included in the database total; they are not extra tests. After the final malformed-login guard, all affected authentication/onboarding database cases passed again: **93 PASS, 0 FAIL**, repeated coverage rather than additional distinct tests. See auth-recheck.json and its complete results/log. Final typecheck, lint and build also pass for that source. All eleven preservation checkpoints pass. Clean install, typechecks, lint and both builds pass. No inherited lint or strict-gate failure remains.

The first complete database attempt recorded 489 passes and three obsolete rejection assertions; browser attempts also exposed selector ambiguity/case mismatch. The final reruns replace those failures with passing evidence. Full audit now has **0 critical, 5 high development entries and 3 moderate production entries**; production-only audit has **0 critical, 0 high, 3 moderate**. Package entries can reflect the same advisory chain and are not distinct vulnerability counts.

## 11. Security/tenant checks

In the exercised cases: **zero cross-tenant reads, zero cross-tenant writes, zero arbitrary organization fallback**. Catalog checks cover ${hardening.checks[0].rlsTables} tables, ${hardening.checks[0].views} views and ${hardening.checks[0].applicationFunctions} application functions. Anonymous data/function access is denied; authenticated writes are denied and reads are restricted to the two scoped Inbox tables. Definer search paths are fixed. Server-role isolation is exercised independently through both applications across every earlier suite.

The new suite records ${hardening.requests} explicit HTTP helper requests, seventeen full-row comparisons across ${hardening.tenantTables.length} tenant-column tables plus organization/contact-memory context, zero measured nonlocal application requests and zero recorded browser page errors. Browser requests are additional to the helper count. Denied onboarding produces no membership writes; concurrent authorized creation produces one organization. Forged metadata, body/query organization IDs, JWT payloads, CSRF origins, foreign parents and viewer writes fail. These are finite local test results.

All earlier populated-upgrade checks and the 031 fingerprint pass. Sanitized promotion excludes generated configuration/Compose credentials. User Docker container IDs match the prior checkpoint. Both current start timestamps predate the Phase 11 archive, establishing no restart after this phase began. The initial environment check incorrectly compared yesterday's start times; the revised check uses the Phase 11 boundary and preserves this distinction. Automatic stacks are removed before the separately requested review workspace is started.

## 12. Known limitations

- Staging, hosted Auth/SMTP, Realtime delivery, physical QR/session reuse, actual WhatsApp acknowledgements, real LLM/embedding provider behavior and sustained production load remain UNVERIFIED. The user will perform live acceptance. There is no production-readiness claim.
- The local review workspace uses real local Auth/REST/database and application APIs, with fixture WhatsApp/provider boundaries. Its QR cannot pair a real phone. Rate limiting is separately verified and bypassed in this large acceptance fixture. Review data is disposable; live/customer credentials are not used.
- Noncritical Axe findings remain. Five high development-tool dependency entries follow the braces/glob chain; three moderate production entries follow Mammoth/argparse/sprintf-js. The affected argparse path is Mammoth's CLI; the app uses its conversion API. No compatible fixes are asserted, and incompatible force-downgrade suggestions are not applied.
- Existing send uncertainty remains explicit: a packet already admitted cannot be recalled; lost acknowledgements may require manual review and are never guessed into an automatic replay.

## 13. Regression risk

031 intentionally revokes broad direct browser table/RPC access. Any external consumer using such access must move behind its authorized server before rollout. Realtime subscription delivery needs the live acceptance check even though SQL read authorization is tested. The schema/code must be rolled out together after backup; keep the WhatsApp encryption key, drain old replicas and preserve delivery evidence. Parent guards can expose pre-existing bad links on a changed relationship rather than repairing history. Framework and transport dependency updates require live acceptance in the target environment.

## 14. Rollback point

Pre-edit archive: ${checkpoint.archive}, ${checkpoint.files} files. SHA256 **${checkpoint.sha256}**. Phase 11 manifest SHA256 **${changes.phase11ManifestSHA256.toUpperCase()}**; Phase 0 remains **${changes.phase0ManifestSHA256.toUpperCase()}**. Restore the verified archive into a separate directory and reconcile later user changes before replacing source. No live database rollback is needed here. A future rollback requires a recoverable database snapshot or reviewed forward fixes; restoring broad browser grants would reopen the exposure. Do not drop preserved runtime/history tables or reinterpret uncertain sends as unsent.

## 15. Next phase dependencies

No later implementation phase is started. Follow [README.md](README.md) for the isolated local review URL/login and shutdown command, and for your live acceptance checklist. Hosted configuration, physical transport, provider, sustained-load and remaining quality findings must be resolved or explicitly assessed before a launch claim. The next unused SQL number is 032. **STOP after this report and local handover.**
`
writeFileSync(resolve(root,'docs/phase11/PHASE_11_COMPLETION_REPORT.md'),report)
console.log('Wrote all 15 required fields from passing final evidence')
