# AIagent

## WA AI Chatbot SaaS v4 - IERE Edition

This repository contains the IERE WhatsApp AI Chatbot monorepo with the Next.js frontend under `frontend/` and the Baileys/Express backend under `backend/`.

The immutable upgrade baseline is in [docs/phase0/BASELINE.md](docs/phase0/BASELINE.md). Phase 1 authorization and tenant isolation changes, verification results and rollback details are in [docs/phase1/PHASE_1_REPORT.md](docs/phase1/PHASE_1_REPORT.md); operational notes are in [docs/phase1/TENANT_SECURITY.md](docs/phase1/TENANT_SECURITY.md). Historical fix/summary documents are reference material and do not prove active runtime behavior. Phases 2-10 are retained as immutable checkpoints. Current Phase 11 local verification and user testing instructions are in [docs/phase11/README.md](docs/phase11/README.md). Staging, physical WhatsApp and production acceptance remain unverified.

## Stack

- Frontend: Next.js App Router, TypeScript, Tailwind CSS, shadcn/ui, TanStack Query
- Backend: Node.js, Express, Baileys, BullMQ, ioredis
- Data: Supabase Postgres with pgvector
- AI: Claude Sonnet 4 primary, Groq fallback, OpenAI fallback

## Project Layout

- `frontend/src/app/`: Next.js App Router pages and API routes
- `frontend/src/components/`: UI components and page-level views
- `backend/src/`: Express API, WhatsApp runtime, AI, queues, flows, handoff
- `supabase/migrations/`: schema, indexes, RLS, seed data, SQL helper functions

## Setup

1. Copy `.env.example` to `.env` and fill in the required values.
2. Install workspace dependencies with `npm install` at the repo root.
3. Start local infrastructure with `docker compose up -d`.
4. Apply the active numbered SQL files in numeric/filename order, including both `011` files and excluding `legacy/`. The complete order is in [supabase/migrations/README.md](supabase/migrations/README.md). The active chain now includes additive hardening `031_rls_integrity_hardening.sql` (PostgreSQL 15+). All upgrade migrations have been exercised locally only; review backup and rollout instructions before applying them to any other database.
5. Start both frontend and backend together with `npm run dev`.
6. Or start services separately with `npm run dev:frontend` and `npm run dev:backend`.

## Verification

- Frontend typecheck: `cd frontend && npm run typecheck`
- Frontend lint: `cd frontend && npm run lint`
- Backend typecheck: `cd backend && npm run typecheck`
- Test typecheck: `npm run typecheck:tests`
- Complete local gate: `node scripts/phase11-verify.mjs`
- Isolated interactive review: see [docs/phase11/README.md](docs/phase11/README.md)

## Runtime Notes

- Authentication uses the `sb-access-token` httpOnly cookie.
- The backend supports degraded mode when optional integrations are not configured.
- WhatsApp sessions are stored in Supabase through `baileys_sessions` and encrypted with AES-256-GCM.
- Booking and alert workflows expect organization-scoped data in Supabase, including devices, team members, contacts, conversations, and settings.
- Older superseded SQL files live under `supabase/migrations/legacy/`. The active migration chain starts at `001_initial_schema.sql`.
