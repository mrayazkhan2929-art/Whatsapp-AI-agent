import { z } from "zod";
export const approvedTools = [
  "property.lookup",
  "property.search",
  "property.compare",
  "property.send_media",
  "knowledge.search",
  "team.lookup",
  "booking.create",
  "handoff.create",
  "contact.update",
  "lead.qualify",
  "calculator.roi",
  "location.send",
] as const;
export const modelIds = [
  "automatic",
  "claude-sonnet-4-20250514",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "llama-3.3-70b-versatile",
] as const;
const text = z.string().trim().max(2000);
export const identitySchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    displayName: z.string().trim().max(120).optional(),
    role: text.optional(),
    persona: text.optional(),
    avatar: z
      .string()
      .max(1000)
      .refine((v) => !v || /^https:\/\//.test(v), "Use an HTTPS avatar URL")
      .optional(),
    description: text.optional(),
    defaultLanguage: z.enum(["en", "ar"]).optional(),
    tone: z.enum(["calm", "friendly", "professional"]).optional(),
    formality: z.enum(["casual", "balanced", "formal"]).optional(),
    responseLength: z.enum(["short", "balanced", "detailed"]).optional(),
    emojiStyle: z.enum(["none", "subtle", "expressive"]).optional(),
    salesStyle: z.enum(["consultative", "informative", "direct"]).optional(),
    conversationStyle: z
      .enum(["one-question", "guided", "conversational"])
      .optional(),
    greetingBehavior: z.enum(["brief", "introduce", "none"]).optional(),
  })
  .strict();
export const instructionPolicySchema = z
  .object({
    businessObjectives: text,
    conversationRules: text,
    salesMethodology: text,
    prohibitedStatements: text,
    escalationBehavior: text,
    companyPolicies: text,
    qualificationStrategy: text,
    propertyRecommendation: text,
    objectionHandling: text,
    followUpRules: text,
    appointmentRules: text,
    handoffRules: text,
  })
  .strict();
export const propertyPolicySchema = z
  .object({
    directInventory: z.boolean(),
    indirectInventory: z.boolean(),
    distressDeals: z.enum(["include", "exclude", "only"]),
    exactReferencePriority: z.literal(true),
    maxResults: z.number().int().min(1).max(20),
    fuzzyMatching: z.boolean(),
    minimumMatchScore: z.number().min(0.7).max(1),
    priceRelaxationPercent: z.number().min(0).max(10),
    areaAlternatives: z.array(z.string().trim().min(1).max(120)).max(10),
    clarificationRules: z.enum(["location-required", "any-constraint"]),
    excludePreviouslyShown: z.boolean(),
  })
  .strict();
export const handoffPolicySchema = z
  .object({
    automatic: z.boolean(),
    onNoMatch: z.boolean(),
    defaultMemberId: z.string().uuid().nullable(),
  })
  .strict();
export const modelPolicySchema = z
  .object({
    provider: z.enum(["auto", "anthropic", "groq"]),
    temperature: z.number().min(0).max(2),
    maxTokens: z.number().int().min(50).max(8000),
    model: z.enum(modelIds).optional(),
    qualityPreference: z.enum(["balanced", "high"]).optional(),
    latencyPreference: z.enum(["balanced", "fast"]).optional(),
    costPreference: z.enum(["balanced", "economy"]).optional(),
    fallbackPolicy: z.enum(["provider-chain", "safe-response"]).optional(),
  })
  .strict();
export const defaultPropertyPolicy = {
  directInventory: true,
  indirectInventory: true,
  distressDeals: "include",
  exactReferencePriority: true,
  maxResults: 3,
  fuzzyMatching: false,
  minimumMatchScore: 0.85,
  priceRelaxationPercent: 0,
  areaAlternatives: [],
  clarificationRules: "location-required",
  excludePreviouslyShown: true,
} as z.infer<typeof propertyPolicySchema>;
export const emptyInstructionPolicy = Object.fromEntries(
  Object.keys(instructionPolicySchema.shape).map((key) => [key, ""]),
) as z.infer<typeof instructionPolicySchema>;
// Historical v1 snapshots retain their previous behavior. Only explicitly upgraded drafts
// opt into the expanded tool allowlist and property settings.
export function permitsTool(
  config: { studioVersion?: 1; tools: string[] } | null | undefined,
  tool: (typeof approvedTools)[number],
) {
  return !config?.studioVersion
    ? tool !== "knowledge.search" || !!config?.tools.includes(tool)
    : config.tools.includes(tool);
}
export function preferredProvider(policy: z.infer<typeof modelPolicySchema>) {
  if (policy.provider !== "auto") return policy.provider;
  if (policy.model === "claude-sonnet-4-20250514") return "anthropic";
  if (policy.model && groqModelIds.includes(policy.model)) return "groq";
  if (policy.qualityPreference === "high") return "anthropic";
  return policy.latencyPreference === "fast" ||
    policy.costPreference === "economy"
    ? "groq"
    : "anthropic";
}
export function selectedModel(
  policy: z.infer<typeof modelPolicySchema>,
  provider: "anthropic" | "groq",
) {
  if (provider === "anthropic") return "claude-sonnet-4-20250514";
  if (policy.model && groqModelIds.includes(policy.model)) return policy.model;
  return policy.qualityPreference !== "high" &&
    (policy.costPreference === "economy" || policy.latencyPreference === "fast")
    ? "openai/gpt-oss-20b"
    : "openai/gpt-oss-120b";
}
// Keep explicit historical Llama snapshots for committed-spend enterprise accounts.
export const groqModelIds: readonly string[] = [
  "openai/gpt-oss-120b", "openai/gpt-oss-20b", "llama-3.3-70b-versatile",
];
