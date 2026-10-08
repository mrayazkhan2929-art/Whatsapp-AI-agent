import { expect, it } from "vitest";
import {
  agentConfigSchema,
  defaultAgentConfig,
} from "../../backend/src/modules/config/AgentVersionService";
import {
  permitsTool,
  preferredProvider,
} from "../../backend/src/modules/config/AgentStudioPolicy";
import {
  studioPlan,
  redactStudioText,
} from "../../backend/src/modules/config/StudioPlayground";
import { upgradeStudioConfig } from "../../frontend/src/lib/agent-studio";
import { propertyTextScore } from "../../backend/src/properties/PropertyMatcher";
const config = () => upgradeStudioConfig(defaultAgentConfig("Calm concierge"));
it("retains historical config without mutating the original while upgrading a draft", () => {
  const old = defaultAgentConfig("Legacy"),
    before = JSON.stringify(old),
    newConfig = config();
  expect(JSON.stringify(old)).toBe(before);
  expect(agentConfigSchema.safeParse(old).success).toBe(true);
  expect(agentConfigSchema.safeParse(newConfig).success).toBe(true);
  expect(permitsTool(old, "property.search")).toBe(true);
  expect(permitsTool({ ...newConfig, tools: [] }, "property.search")).toBe(
    false,
  );
});
it.each([
  [
    "inventory safety",
    () => ({
      ...config(),
      propertyPolicy: {
        ...config().propertyPolicy!,
        exactReferencePriority: false,
      },
    }),
  ],
  [
    "excessive price relaxation",
    () => ({
      ...config(),
      propertyPolicy: {
        ...config().propertyPolicy!,
        priceRelaxationPercent: 11,
      },
    }),
  ],
  [
    "weak fuzzy score",
    () => ({
      ...config(),
      propertyPolicy: { ...config().propertyPolicy!, minimumMatchScore: 0.2 },
    }),
  ],
  [
    "unbounded results",
    () => ({
      ...config(),
      propertyPolicy: { ...config().propertyPolicy!, maxResults: 1000 },
    }),
  ],
  ["executable tools", () => ({ ...config(), tools: ["execute.code"] })],
  ["platform secrets", () => ({ ...config(), apiKey: "secret" })],
  ["forged tenant", () => ({ ...config(), org_id: "foreign" })],
  [
    "identity protocol",
    () => ({
      ...config(),
      identity: { ...config().identity, avatar: "javascript:alert(1)" },
    }),
  ],
  [
    "unsupported default language",
    () => ({
      ...config(),
      languages: ["en"],
      identity: { ...config().identity, defaultLanguage: "ar" },
    }),
  ],
  [
    "mismatched provider",
    () => ({
      ...config(),
      modelPolicy: {
        ...config().modelPolicy,
        provider: "groq",
        model: "claude-sonnet-4-20250514",
      },
    }),
  ],
  ["company override", () => ({ ...config(), companyInheritance: "agent" })],
  ["incomplete sections", () => ({ ...config(), propertyPolicy: undefined })],
] as const)("rejects %s", (_name, attack) =>
  expect(agentConfigSchema.safeParse(attack()).success).toBe(false),
);
it.each([
  "أريد التحدث مع موظف",
  "I need a human",
  "Hello",
  "مرحبا",
  "show villas in JVC",
  "reference REF-100",
])("plans bounded English/Arabic draft input: %s", (message) => {
  const plan = studioPlan(config(), message);
  expect(["en", "ar"]).toContain(plan.detectedLanguage);
  expect(plan.tools.every((t) => config().tools.includes(t))).toBe(true);
  expect(plan.criteria.excludeRefs).toEqual([]);
});
it("preserves explicit reference identity rather than substituting fuzzy alternatives", () => {
  const plan = studioPlan(config(), "reference REF-100");
  expect(plan.criteria.referenceNumber).toBe("REF-100");
  expect(plan.tools).toEqual(["property.lookup"]);
});
it("records denied tools without selecting or executing them", () => {
  const plan = studioPlan({ ...config(), tools: [] }, "show villas in JVC");
  expect(plan.tools).toEqual([]);
  expect(plan.deniedTools).toContain("property.search");
});
it("uses approved provider preferences with legacy precedence", () => {
  expect(preferredProvider(config().modelPolicy)).toBe("anthropic");
  expect(
    preferredProvider({ ...config().modelPolicy, costPreference: "economy" }),
  ).toBe("groq");
  expect(
    preferredProvider({
      ...config().modelPolicy,
      provider: "anthropic",
      latencyPreference: "fast",
    }),
  ).toBe("anthropic");
});
it("redacts secrets and contact values while retaining verified prices", () =>
  expect(
    redactStudioText(
      "sk-secretToken x@example.invalid +971 500 001 222 AED 1200000",
    ),
  ).toBe("[redacted secret] [redacted email] [redacted phone] AED 1200000"));
it("scores bounded normalized spelling without accepting unrelated areas", () => {
  expect(propertyTextScore("Dubai Marina", "Dubai Marna")).toBeGreaterThan(
    0.85,
  );
  expect(propertyTextScore("JVC", "Downtown")).toBeLessThan(0.7);
  expect(propertyTextScore("x".repeat(201), "z")).toBe(0);
  expect(propertyTextScore("JVC", "jvc")).toBe(1);
});
