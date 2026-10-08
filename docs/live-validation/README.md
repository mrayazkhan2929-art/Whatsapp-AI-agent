# Real local WhatsApp testing and online launch

The Phase 11 manual preview was a fixture: its gateway returned a simulated QR. That QR cannot pair a phone. The separate real runtime added here runs `backend/dist/index.js` with the actual Baileys gateway. No Vitest or provider mocks are loaded.

## Start and scan

Run from the repository root:

```powershell
node scripts/live-local.mjs background
node scripts/live-local.mjs status
```

Use the frontend URL in the status output. The generated local owner login is in `test-results/live-local/LOCAL_ACCESS.md`; it is intentionally excluded from source control. Go to **Devices**, click **Reconnect** (or **Connect**) on **Real WhatsApp phone test**, and scan the refreshed QR using your phone's **WhatsApp → Linked devices → Link a device**. Use the WhatsApp scanner, rather than the camera app. QR challenges expire, so use the refreshed screen rather than a saved screenshot.

The initial real HTTP check is:

```powershell
node scripts/live-local-probe.mjs
node scripts/live-local-browser.mjs
```

The probe creates a local device if necessary and connects it. It never sends a WhatsApp message or simulates a phone scan. Once a device is live connected it preserves that session; avoid rerunning the probe while scanning.

## What runs here

Database, Auth, REST, Redis and local confirmation email run in Docker, using the pinned Supabase `self-hosted/v0.8.2` service images validated in Phase 11. The frontend and backend run as actual production-built Node processes on Windows. This is a local integration environment, not an online deployment or a complete self-hosted Supabase installation.

All Docker ports, the frontend and the backend bind to loopback. The backend now accepts `HOST`; this launcher explicitly sets `127.0.0.1`. Its default remains `0.0.0.0` for deployed containers. Do not forward these local ports publicly. The backend makes actual outbound WhatsApp connections.

The new database starts fresh. Active migrations are replayed in deterministic numeric/filename order, including both `011` files, with errors stopping startup. A local private migration ledger checks hashes on restart. Historical SQL and Phase 0–11 reports/manifests remain unchanged. Existing `iere-*` containers and their volumes are not reused or modified.

Database and Redis use dedicated persistent named volumes. The same private database credentials and WhatsApp encryption key are retained in `test-results/live-local/private-config.json`, so a restart does not create a new database or lose the session decryption key. These local keys are not production credentials. Protect the entire directory and never publish it or copy it into a Docker image. Local email is visible at the Mailpit URL in status; it is not sent to a real inbox.

Stop with:

```powershell
node scripts/live-local.mjs stop
```

This shuts down only this runtime/project and retains its volumes. Start again with the same command above. Explicitly disconnect/unlink the device in the app or phone when you finish testing a real account. Stopping the runtime alone preserves its pairing.

## Remaining real acceptance checks

1. Scan successfully and verify the app shows a live **Connected** state.
2. Configure a real AI provider securely and publish tenant instructions. This initial environment has no provider API keys; it does not prove AI replies work. Create `test-results/live-local/providers.env` locally with the chosen `OPENAI_API_KEY`, `GROQ_API_KEY` or `ANTHROPIC_API_KEY` assignment. Do not send keys in chat. Stop/start this runtime to load the file, confirm `providersConfigured` in status, then select the corresponding provider/model in the agent workspace and publish the agent. The file permits only those three server-side keys and is excluded from source control.
3. From a second phone you control, send a message to the paired account. Verify one inbound message, the intended reply, tenant ownership and no duplicate sends.
4. Restart the backend with the same database/encryption key. Confirm reconnection without another QR and repeat the message round trip.
5. Exercise handoff and any media/provider functionality you intend to use. Browser Realtime delivery is not provided by this minimal local Auth/REST stack and remains a separate acceptance check.

The automated QR check proves that an actual WhatsApp QR was received through both applications. The user subsequently confirmed successful phone pairing. The paired device reconnected after a runtime restart; the read-only `live-local-check.mjs` verifies a live, healthy socket and decrypts saved paired credentials with the retained key without printing them. No real message round trip or provider reply has been verified.

The real run also exposed and fixed a socket health adapter bug: Baileys exposes `isOpen`, `isConnecting` and `isClosing` on its wrapper, rather than `readyState`. Four regression cases exercise the installed wrapper getters. Before the fix, healthy sockets were incorrectly reported as missing.

## Online staging, then production

Use a continuously running Node 22 backend service for Baileys and workers, plus persistent Redis and Supabase. A managed Supabase project reduces database/Auth/Realtime operations. The Next.js frontend can be a separate service. A Linux Docker VPS is another option; self-hosting Supabase also requires maintaining backups, upgrades and the other Supabase services.

Railway persistent services support long-running applications: <https://docs.railway.com/build-deploy>. Supabase self-hosting and production responsibility: <https://supabase.com/docs/guides/self-hosting/docker>. Baileys QR and credential persistence: <https://github.com/WhiskeySockets/baileys.wiki-site/blob/main/docs/socket/connecting.md>.

Before provisioning paid hosting, select the provider/domain and a dedicated staging Supabase project. Prepare reviewed container builds and secure environment variables, then run this same real pairing/message/restart acceptance over HTTPS. Keep service-role keys and `WA_SESSION_ENCRYPTION_KEY` server-side, preserve the encryption key across releases, configure Auth redirects/cookie origins, and verify backups and restoration. Run the tenant suite against isolated staging data. This local launcher now uses the Next.js standalone server with its static/public assets copied into the standalone output; deploy those assets in the eventual container build too.

Move to production only after those checks pass. No online infrastructure was created and no production database was migrated by this work.

## Rollback

`checkpoint.json` identifies the pre-change source archive and SHA256. Changes comprise the local launcher/probe/browser/read-only check scripts, the socket health adapter, optional backend bind address and preservation test allowlist. All previous phase evidence and historical SQL remain immutable. Stop the real runtime before restoring source into a separate recovery directory. Preserve the private key/config and named volumes if you need to recover a paired session. Never restore an old source archive over live database data.
