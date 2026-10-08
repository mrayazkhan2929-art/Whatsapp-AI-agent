# Online validation deployment

Deploy the repository as two Railway services from `main`, keeping the repository root as the build context. Set each service's Railway config file to `/deploy/backend.railway.json` or `/deploy/frontend.railway.json`. Both images use Node 22, the committed npm lockfile, non-root processes and Railway's runtime PORT. Only public Supabase configuration enters the frontend build.

Backend runtime variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `WA_SESSION_ENCRYPTION_KEY` (64 random hex characters), `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `NEXT_PUBLIC_APP_URL`. Keep the encryption key stable across every deployment. Deploy one backend replica with sleeping disabled. Configure Redis with authentication and persistent storage, reachable through private networking only.

Frontend build/runtime variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Frontend runtime variables: `SUPABASE_SERVICE_ROLE_KEY`, `BACKEND_URL`, `NEXT_PUBLIC_APP_URL`. `BACKEND_URL` points to the backend's private Railway address and runtime port. `NEXT_PUBLIC_APP_URL` is the exact public HTTPS frontend origin. Configure that origin in Supabase Auth site/redirect settings.

Apply the existing 32 active SQL files in numeric/filename order, including both 011 files and excluding `legacy`. Historical cleanup migrations must only replay against a verified empty project. A populated project requires a data-preserving upgrade plan and backup. Migration hashes and actual command results belong in the deployment report.

The initial online deployment is for owner acceptance testing. Create the real tenant through registration and onboarding. Stop the local runtime before pairing the same WhatsApp number online. Configure/publish the agent and link it to the online device, then verify a real inbound/reply exchange and restart recovery. Local paired credentials and test data are not copied into the hosted tenant.

Rollback: keep the pre-deployment source archive recorded in `checkpoint.json`, retain the Git commit and Railway prior deployment, and preserve Supabase/Redis data and the session encryption key. Do not replay historical cleanup migrations or reset customer tables as a rollback. Database backups and adequate hosting capacity must be configured before admitting paying customers.
