# Phase 7 — Knowledge documents and governed retrieval

This is the current knowledge lifecycle runbook. The Master Codex Implementation Prompt controls the upgrade, and repository code plus executed checks establish its behavior. Phase 0–6 documents remain unchanged historical evidence. Phase 8 has not begun.

## Document lifecycle

An upload creates a tenant-owned document and a queued version before parsing or provider work. Original bytes are retained privately in the database as bounded base64, with source filename, type and SHA-256. No source URL is fetched. Supported uploads are PDF, DOCX, TXT, Markdown and JSON, between 1 byte and 2 MB.

Versions progress through queued, parsing, embedding and ready, or failed. The worker uses a persisted claim token with a ten-minute lease. An expired claim can recover; a stale token cannot commit. Up to three claimed attempts are allowed before exhausted recovery becomes a visible failure. Provider errors produce failure status rather than zero embeddings. Each indexing attempt embeds the chunk batch once, validates the vectors and inserts its chunks atomically.

Publishing the index switches a document's current version only if that version is still the latest. An older worker finishing later cannot reactivate superseded content. Failed replacements retain the prior successful index. Reindexing creates a new version from retained source bytes; legacy records can copy their retained chunks as a new text source. A replacement's own filename/type determines reindex parsing.

Disable excludes the document immediately from future searches; enable restores its current successful version. Delete is a soft deletion that excludes future retrieval and indexing while preserving its original source, versions and vectors for recovery. Deleted queued records neither occupy admission capacity nor prevent later queued work from recovering. Upload admission limits a tenant to 100 pending nondeleted versions; each document permits up to 1,000 versions. Recovery processes up to ten eligible versions per sweep.

## Parsing boundaries

PDF parsing uses pinned `pdf-parse` 2.4.5 with evaluation disabled and a maximum of 200 pages. DOCX parsing uses pinned `mammoth` 1.13.0 to extract raw text, never HTML. A ZIP directory preflight bounds declared expanded DOCX data to 8 MB and 500 entries and rejects path traversal entries. UTF-8 text and JSON are validated. Parsed text is bounded to 2 MB and indexing to 200 chunks of at most 16,000 characters. Unsupported, empty, malformed or excessive content becomes a visible validation/index failure.

These bounds do not provide a separate OS sandbox or OCR. Images/scanned PDFs with no extractable text fail visibly. Legacy `.doc` is not advertised or accepted. Provider/parse failure codes exclude raw exception details and source text.

## Retrieval and provenance

Runtime retrieval uses the active published agent version and its allowed knowledge IDs. Requested IDs cannot expand that scope. Both service preflight and SQL validate the organization, agent/version pointer, immutable knowledge links and knowledge-base owner. There is no first-knowledge-base or all-tenant-knowledge fallback. Changing a draft does not affect retrieval; publish changes the allowed snapshot.

The query combines the existing 1,536-dimensional cosine vector search with English stemming and normalized multilingual `simple` lexical search. Arabic alef variants, diacritics, tatweel, alif maqsura and taa marbuta receive consistent normalization. Parameterized `plainto_tsquery` handles punctuation as data. Vector failure can fall back to lexical search and marks the trace degraded. Reciprocal rank fusion merges the two ranked result sets.

Only enabled, nondeleted documents whose current version is ready can contribute excerpts. Provenance includes knowledge base, document, version ID/number and chunk ID/index. Runtime traces are returned by chat and retained in outgoing message metadata without excerpt bodies. Retrieval preview uses the same published scope; it is not a provider-generated answer.

Known English/Arabic instruction-injection patterns are quarantined and recorded by chunk ID. Retrieved text is serialized as JSON in a separate user data message, never concatenated into the system prompt. Platform rules keep higher authority, and tenant/ownership/tool boundaries remain enforced independently of model output. These controls and controlled malicious fixtures do not claim perfect classification of every possible natural-language attack.

The former static FAQ fallback is removed. Missing tenant knowledge cannot silently supply fixed company/market claims. Configured knowledge can serve FAQ, chat and general-answer lanes while existing company/property/handoff paths preserve their behavior.

## APIs and workspace

The backend mounts these routes below `/api/v1/knowledge`; frontend `/api/knowledge` forwards bearer/cookie authentication and the binary body to that backend:

- GET `/:kb/documents`: up to 100 documents, recent versions and current successful version metadata.
- POST `/:kb/documents`: upload binary bytes as `application/octet-stream`; `x-document-name` contains the encoded filename. Returns 202 with document/version IDs and durable queued status.
- POST `/:kb/documents/:id/versions`: replacement upload.
- GET `/:kb/documents/:id/versions?before=N`: cursor-based history, 20 versions per page.
- POST `/:kb/documents/:id/reindex`: retain prior versions and enqueue another index.
- PATCH `/:kb/documents/:id` with `{ "enabled": true/false }`.
- DELETE `/:kb/documents/:id`: soft-delete.
- POST `/retrieval` with query and agent ID: preview the active published snapshot. Client organization, KB and version fields cannot override it.

Viewers can read and preview but cannot mutate documents. Foreign references return 404; invalid input returns 400/413; inactive/unpublished preview selection returns 409; database failures remain 500. Private document/version/provenance tables and indexing/retrieval RPCs reject anonymous/authenticated direct REST access. Direct authenticated chunk mutations cannot bypass the lifecycle.

Knowledge Base and its detail route use the responsive calm SaaS workspace. It has working knowledge-base creation, document upload, version targeting, indexing/failure status, enable/disable, reindex, deletion confirmation, paged history and governed retrieval preview. Loading, empty, read-only, validation, conflict/service errors and saved/unsaved selection states are visible. Existing knowledge-base CRUD API envelopes remain compatible. Card chunk totals count retained history rather than only the current index.

## Migration and verification

Migration `026_knowledge_documents.sql` adds documents, versions, a provenance association table, guards, private RPCs and lexical indexes. It links historical chunks through the association table without updating their IDs, content, metadata, timestamps or embeddings. Tenant-inconsistent historical links remain intact and unavailable to retrieval. Existing numeric SQL is unchanged; the next available number is 027.

`npm run test:knowledge:db` creates disposable digest-pinned `self-hosted/v0.8.2` database/Auth/REST services with loopback ports, generated local credentials, isolated names and temporary storage. It refuses live environment files, replays every active numeric SQL file including both 011 files in filename order, excludes `legacy/`, verifies populated cutovers, and cleans up its own containers/volumes. Provider, embedding and WhatsApp calls are stubbed; HTTP, Auth, SQL, parser fixtures, browsers and restart processes are real.

`node scripts/phase7-verify.mjs` runs clean installation, application/test typechecks, lint, builds, ordinary/strict/browser suites and all seven database files. The final SQL and UI follow-up scripts repeat the knowledge database/browser subset after the combined gate; `phase7-ui-verify.mjs` also repeats typechecks, lint, build, all-tests and strict tests. `node scripts/phase7-evidence.mjs` promotes the complete final sanitized evidence. `node scripts/phase7-files.mjs` compares against the verified rollback archive and protects historical evidence and SQL. Command results are recorded in the completion report, including inherited lint/audit exceptions and development corrections.

## Operation and rollback

1. Local verification applies no live migration. A future deployment needs a database backup and review, migration 026 before the updated application, then checks of active agent knowledge attachments and document coverage.
2. Configure the existing platform embedding credential securely. Missing/unavailable embedding infrastructure fails document indexing visibly; retrieval can still use retained lexical coverage. No parser fixture credential is a production credential.
3. On startup and every 30 seconds the backend recovers eligible durable indexing claims. An upload also starts processing after its 202 response. Claim fencing makes concurrent inline/periodic/restarted workers safe; it does not promise exactly-once embedding billing across a crashed provider call.
4. Check failure status, fix source/configuration and reindex. The old successful version remains available until a newer version indexes successfully. Disable a document first when its old facts must stop being used immediately.
5. For application rollback, verify `checkpoint.json` and extract the archive into a separate review directory. Preserve additive tables, document state and all original chunks/vectors. Do not drop the schema or automatically erase source/claims. Older RAG code does not understand disable/delete/current-version filters, so reverting the application requires an operational decision about knowledge visibility.
6. Deletion retains history for recovery; retention/privacy erasure policies and OCR are separate work. Keep local evidence and temporary generated credentials out of a production release.

Stop after the Phase 7 report. Phase 8 requires explicit authorization.
