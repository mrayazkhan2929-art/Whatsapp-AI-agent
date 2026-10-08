# Supabase Migration Order

Apply the active v4 migration chain in this order:

1. `001_initial_schema.sql`
2. `002_pgvector.sql`
3. `003_properties_seed.sql`
4. `004_team_members_seed.sql`
5. `005_rls_policies.sql`
6. `006_vector_functions.sql`
7. `007_nudge_functions.sql`
8. `008_sentiment_functions.sql`
9. `009_alert_functions.sql`
10. `010_indirect_properties_inventory_gaps.sql`
11. `011_message_deduplication.sql`
12. `011_properties_distress_deal.sql`
13. `012_agent_assignment.sql`
14. `013_contact_memory_and_cleanup.sql`
15. `014_ai_pipeline_cleanup.sql`
16. `015_runtime_routing_and_data_cleanup.sql`
17. `016_fix_conversations_unique_constraint.sql`
18. `017_tenant_data_api_guard.sql`
19. `018_organization_profiles.sql`
20. `019_agent_versions.sql`
21. `020_agent_runtime_links.sql`
22. `021_conversation_state.sql`
23. `022_property_identity_and_media.sql`
24. `023_message_idempotency.sql`
25. `024_agent_routing_rules.sql`
26. `025_handoff_lifecycle.sql`
27. `026_knowledge_documents.sql`
28. `027_agent_studio.sql`
29. `028_ai_observability.sql`
30. `029_audit_logs.sql`
31. `030_device_runtime_leases.sql`
32. `031_rls_integrity_hardening.sql`

Notes:

- Older superseded SQL files that would otherwise conflict with the canonical numbering now live in `legacy/`.
- Any older references to `001_core_schema.sql` or `002_rls_policies.sql` are stale. Use the numbered chain above.
- Include both historical `011` files; never rename deployed migrations. Replay errors must fail visibly.
- Phase 1's additive `017` guard requires PostgreSQL 15+ and was authorized for local testing only. It makes compatibility views obey base-table RLS and reserves normalized contact memory for the authorized server. Historical SQL remains unchanged.
- `031_rls_integrity_hardening.sql` is the final additive tenant/RPC privilege and parent-integrity guard. It was exercised only in disposable local stacks. The next available number is `032`; historical SQL is unchanged.
