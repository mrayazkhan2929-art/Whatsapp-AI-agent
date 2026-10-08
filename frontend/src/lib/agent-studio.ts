import type { AgentConfig } from "../../../backend/src/modules/config/AgentVersionService";
export type { AgentConfig };
export const studioTools = [
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
export const instructionLabels = {
  businessObjectives: "Business objectives",
  conversationRules: "Conversation rules",
  salesMethodology: "Sales methodology",
  prohibitedStatements: "Prohibited statements",
  escalationBehavior: "Escalation behavior",
  companyPolicies: "Company policies",
  qualificationStrategy: "Qualification strategy",
  propertyRecommendation: "Property recommendation behavior",
  objectionHandling: "Objection handling",
  followUpRules: "Follow-up rules",
  appointmentRules: "Appointment rules",
  handoffRules: "Handoff rules",
};
export function upgradeStudioConfig(config: AgentConfig): AgentConfig {
  return {
    ...config,
    studioVersion: 1,
    companyInheritance: "authoritative",
    identity: {
      displayName: config.identity.name,
      defaultLanguage: config.languages[0],
      tone: "calm",
      formality: "balanced",
      responseLength: "balanced",
      emojiStyle: "subtle",
      salesStyle: "consultative",
      conversationStyle: "guided",
      greetingBehavior: "introduce",
      ...config.identity,
    },
    instructionPolicy:
      config.instructionPolicy ??
      (Object.fromEntries(
        Object.keys(instructionLabels).map((key) => [key, ""]),
      ) as NonNullable<AgentConfig["instructionPolicy"]>),
    propertyPolicy: config.propertyPolicy ?? {
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
    },
    handoffPolicy: config.handoffPolicy ?? {
      automatic: true,
      onNoMatch: false,
      defaultMemberId: null,
    },
    modelPolicy: {
      model: "automatic",
      qualityPreference: "balanced",
      latencyPreference: "balanced",
      costPreference: "balanced",
      fallbackPolicy: "provider-chain",
      ...config.modelPolicy,
    },
    tools: config.studioVersion
      ? config.tools
      : ([
          ...new Set([
            ...config.tools,
            "property.lookup",
            "property.search",
            "property.compare",
            "property.send_media",
            "team.lookup",
            "handoff.create",
          ]),
        ] as AgentConfig["tools"]),
  };
}
export async function studioApi<T>(
  id: string,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const r = await fetch("/api/agents/" + id + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    json = await r.json();
  if (!r.ok)
    throw Error(
      typeof json.error === "string"
        ? json.error
        : (json.error?.message ?? "Operation failed"),
    );
  return json.data;
}
