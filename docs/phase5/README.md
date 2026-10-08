# Phase 5 — Durable message idempotency

This is the active transport reference after Phase 5. Earlier descriptions of process-local message locks/fingerprints are historical. The controlling scope is `Master_Codex_Implementation_Prompt_v1.md`; runtime behavior is verified against the current repository.

## Runtime and ownership

```
Baileys notify event (original key.id + server-owned org/device)
  -> receive_whatsapp_message (atomic receipt/contact/conversation/inbound persistence)
  -> claim_whatsapp_execution (one database winner)
  -> existing published agent / property / conversation-state orchestration
  -> prepare_whatsapp_response (one saved reply, metadata and execution checkpoint)
  -> claim_whatsapp_send (one database winner)
  -> existing gateway/Baileys adapter with saved outbound ID and original device/JID
  -> finish_whatsapp_send (saved receipt outcome and conversation timestamp)
```

`messages` remains the logical inbound/outbound store. New nullable fields leave historical rows intact. Identity uniqueness covers `(org_id, device_id, wa_message_id, direction)` when device and WhatsApp IDs are present. A unique `reply_to_message_id` permits one logical response per inbound event. Both endpoints of a response share an organization, device and conversation; database validation enforces this.

`message_receipts` is a small admission ledger, not another message store. It retains the original scoped identity when authorized deletion removes contact/conversation history. Device deletion preserves receipts and message device identities; new writes validate ownership under a database key-share lock. A stale event for a deleted device is rejected. Organization deletion retains its existing data-removal behavior.

Only explicit tenant-valid historical conversation/device links seed receipts. Duplicate old IDs and unknown device mappings remain unchanged. No synthetic historical WhatsApp ID or inferred device assignment is added. Historical events without a known device need operational reconciliation before replaying them across the cutover.

All transport RPCs and the receipt table are server-only, use invoker security and reject public/anon/authenticated access. Existing message RLS stays enabled. An authenticated role cannot mutate/delete a transport row, including when an organization claim grants row visibility. Application reads continue to resolve tenant membership on the server. Frontend deletion returns `409 TRANSPORT_RECORD_REQUIRED` for a saved transport response and retains the existing `404` for foreign IDs.

## Recovery and limits

| Saved state | Behavior |
| --- | --- |
| `received` | A replay can safely claim the business execution. |
| `processing` | The claim is never automatically transferred or executed again. A crashed execution needs review. |
| `prepared` | A replay or the existing gateway's connected event resumes the saved reply, without AI regeneration. Recovery drains batches of 100 until empty. |
| `sending` | A lost receipt or interrupted send requires reconciliation. No automatic resend occurs. |
| `completed` | All replays are suppressed. |
| `ignored` | Unsupported/empty input is saved once without business execution. |
| `needs_review` | Uncertain business/send effects are retained; replay does not regenerate or resend them. |

The verified normal replay invariant is one logical inbound, one business execution and one outbound send for repeated events, concurrent events, a restarted process and two processes. This does not prove delivery exactly once by the external WhatsApp service. A crash after remote acceptance but before acknowledgement cannot be safely converted into a guaranteed resend. The implementation favors preventing duplicate effects and exposes uncertain outcomes.

Different WhatsApp IDs with identical text are distinct events. Registered handlers execute inside the single claim. Provider errors produce one saved localized fallback; transport/persistence errors do not cause a second fallback send. Failed/pending outbound replies are excluded from the assistant's delivered conversation history. The saved outbound ID reaches Baileys' `sendMessage` options; receipt/device mismatches require review and cannot switch the originating device.

No environment variable, model, Redis queue, session lease, handoff lifecycle or typed media-delivery feature is added. The legacy `messageLock.ts` remains available for rollback context but has no active production caller. Baileys session ownership is still process-local; these tests do not authorize horizontally scaling live sockets before the designated ownership phase.

## Operator runbook

1. Before a future rollout, back up the database and apply migration 023 before releasing the new application. This work applied SQL only to disposable local databases.
2. Inspect affected messages using the server-resolved organization and device. Check `processing_status`, `failure_code`, `wa_message_id`, `reply_to_message_id` and timestamps. The inbox distinguishes pending, unconfirmed and review states and avoids a sent tick for an uncertain response.
3. `prepared` recovery is automatic on connection/replay. Use `MessageRouter.resumePending(deviceId, orgId)` only inside the existing device-owner runtime if an additional drain is needed; do not launch another socket owner.
4. For an interrupted `processing` execution, establish that the owner has stopped and reconcile any business effects before marking it `needs_review`. Never reset it to `received` simply to retry.
5. For `sending`, reconcile the saved outbound WhatsApp ID with the transport receipt. A confirmed receipt can be recorded through `finish_whatsapp_send` using the stored claim token and exact tenant/device context. Otherwise record an uncertain outcome and review manually. Do not create another response or reset it to `prepared` without evidence that no remote send occurred.
6. Restore the pre-edit application archive into a separate directory for rollback review. Keep additive columns, indexes and receipt data. Re-enabling old processing loses these guarantees and requires an explicit operational decision.

## Local verification

`npm run test:messages:db` starts a pinned `self-hosted/v0.8.2` Docker DB/Auth/REST stack with generated local credentials, loopback ports, isolated names and temporary storage. It refuses live environment files. All active SQL files replay in filename order, including both 011 files; `legacy/` is excluded. Populated historical fixtures prove preservation when 023 is applied. Every command/replay failure is visible, and cleanup runs even after failure.

`node scripts/phase5-verify.mjs` collects clean installation, both application typechecks/builds, test typechecking, lint, ordinary/tenant/AI/browser suites, strict gates and the combined database suite. Known inherited gates remain visible. Previous phase evidence, SQL and manifests are immutable outside the cumulative explicit source allowlist.

The final completion report records results and rollback hashes. Stop before Phase 6.
