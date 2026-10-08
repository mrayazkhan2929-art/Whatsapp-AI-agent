# Property import and agent launch

Authorized scope: import the supplied Properties.csv into IERE and publish one agent for the owner to test.

- Imported 204 unique properties in one atomic insert: 114 sale, 90 rent; 87 off-plan, 117 ready. Verified every imported reference, price, transaction category, type, status and availability against the prepared CSV.
- Preserved the supplied file and existing company/agent state in the ignored local test-results/property-launch directory before writes. Original CSV was not edited.
- Preserved all 33 unsupported commercial/plot categories in property descriptions; their type remains null because the existing schema only permits residential types. Their references remain searchable. No production migration was added.
- All 204 source agent phone values are rounded scientific notation. Left agent_whatsapp null rather than fabricate contact numbers; original values remain in the private source backup.
- Preserved SARA AI identity, instructions, capabilities, knowledge and business policies. Changed the model to Groq openai/gpt-oss-120b, passed all 10 mandatory checks and real English/Arabic model previews, published version 1 and explicitly linked the connected device.
- Fixed reference parsing so slash-delimited and numeric-prefix listing references are recognized and their numeric segments cannot become price ranges. Genuine budgets outside references remain supported.
- Fixed known parenthetical district aliases from portal exports, while retaining unknown parenthetical names exactly. CSV district values were preserved.
- Backend build/typecheck and test typecheck passed. Strict suite: 335 passing, zero expected failures, zero failures. Secret scan: zero findings. Historical phase manifests and SQL remain unchanged.
- Read-only property previews passed exact apartment/plot references, Arjan sale and JVC rent queries. Groq previews and configuration checks performed zero WhatsApp sends, contact writes, conversation writes or bookings.

Rollback: pre-change Git revision 10b6e7a765a70e22e20b4e1b0396b7d28d2a4c19 and archive F:/Whatsapp AI Conversation Agent/WA-bot-upgrade-v4/property-launch-pre-fix-20261008.zip (SHA256 36706D1F3FAABCD44DA9C2732359A79916DC5F121D24EA4EA00C472ADAEDCE17). Restore the previous backend deployment for code rollback. For configuration rollback, pause the agent and remove its channel link; the previous state had no published version. Exact newly inserted IDs are in private test-results/property-launch/inserted.json, to remove only this import within its recorded organization if explicitly requested. Preserve audit/version history and the paired WhatsApp session.

Hosted deployment verification is recorded separately after the tested change is deployed. The owner performs the final real WhatsApp round trip.
