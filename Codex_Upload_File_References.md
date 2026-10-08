# Codex Upload File Reference
## WhatsApp AI Agent SaaS Upgrade

Upload the files below together when asking Codex to implement the audited upgrade.

## Mandatory

1. `Master_Codex_Implementation_Prompt_v1.md`
   - Controlling implementation instruction.
   - Use this to execute the approved Phase 0 → Phase 11 upgrade.

2. `Whatsapp_AI_Agent-main(2).zip`
   - Current source repository.
   - Source of truth for what is actually implemented.
   - Codex must inspect the code before changing it.

3. `Instraction v4.txt`
   - Original audit requirements, architectural principles, acceptance criteria, and stop conditions.

## Recommended supporting references

4. `ARCHITECTURE_FIX_SUMMARY(1).md`
   - Historical architecture/fix context only.

5. `IMPLEMENTATION_GUIDE.md`
   - Historical implementation guidance only.

6. `PRODUCTION_FIX_v5.0_SUMMARY(2).md`
   - Historical fix claims.
   - Must NOT be treated as proof that a fix exists in the current runtime.

7. `WA_AI_CHATBOT_IERE_MASTER_PROMPT_v4(2).md`
   - Earlier product/behavior blueprint.

8. `IERE_CURSOR_MASTER_PROMPT_v2(2).md`
   - Earlier implementation context.

## Authority order when files conflict

1. `Master_Codex_Implementation_Prompt_v1.md`
2. Current repository (`Whatsapp_AI_Agent-main(2).zip`) for factual current-state implementation
3. `Instraction v4.txt` for requirements and acceptance criteria
4. Historical/supporting documents

## Recommended message to send with the files

Use:

> Read `Master_Codex_Implementation_Prompt_v1.md` completely and inspect the current repository before modifying anything. Use the current repository as the factual source of truth for existing implementation. Begin only with **PHASE 0 — Baseline + Safety Harness**. Complete Phase 0, run the required verification/tests, provide the required phase report, and STOP. Do not start Phase 1 until I explicitly say `next phase`.

