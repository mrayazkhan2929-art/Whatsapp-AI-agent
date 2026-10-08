import { beforeEach, expect, it, vi } from "vitest";
import { defaultAgentConfig } from "../../backend/src/modules/config/AgentVersionService";
const effects = vi.hoisted(() => ({
  anthropic: vi.fn(),
  groq: vi.fn(),
  options: [] as unknown[],
  rows: [] as any[],
  storageFailure: false,
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    constructor(options: unknown) {
      effects.options.push(options);
    }
    messages = { create: effects.anthropic };
  },
}));
vi.mock("groq-sdk", () => ({
  default: class {
    constructor(options: unknown) {
      effects.options.push(options);
    }
    chat = { completions: { create: effects.groq } };
  },
}));
vi.mock("../../backend/src/config/supabase", () => ({
  isSupabaseConfigured: () => true,
  getSupabaseAdmin: () => ({
    from: () => ({
      insert: async (row: unknown) => {
        effects.rows.push(row);
        return {
          error: effects.storageFailure ? { code: "unavailable" } : null,
        };
      },
    }),
  }),
}));
import {
  ModelGateway,
  estimatedCost,
} from "../../backend/src/modules/ai/ModelGateway";
import { ResponseValidator } from "../../backend/src/modules/ai/ResponseValidator";
import { executionTrace } from "../../backend/src/modules/observability/ExecutionTraceService";
import {
  redactEvidence,
  safeCriteria,
  safeEvidence,
} from "../../backend/src/modules/observability/TracePrivacy";
beforeEach(() => {
  effects.rows.length = 0;
  effects.options.length = 0;
  effects.storageFailure = false;
  vi.stubEnv("ANTHROPIC_API_KEY", "local-stub");
  vi.stubEnv("GROQ_API_KEY", "local-stub");
  vi.stubEnv("AI_COST_RATES_JSON", "");
  effects.anthropic
    .mockReset()
    .mockResolvedValue({
      content: [{ type: "text", text: "Verified answer." }],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
  effects.groq
    .mockReset()
    .mockResolvedValue({
      choices: [{ message: { content: "Verified secondary answer." } }],
      usage: { prompt_tokens: 120, completion_tokens: 15 },
    });
});
const request = () => ({
  config: defaultAgentConfig("Assistant"),
  system: "Platform safety",
  messages: [{ role: "user" as const, content: "Question" }],
  route: { lang: "en" as const, lane: "CHAT" as const },
});
for (const [text, route, reason] of [
  ["", { lang: "en", lane: "CHAT" }, "nonempty"],
  [
    "Thanks for your patience.",
    { lang: "en", lane: "CHAT" },
    "no_legacy_handoff_claim",
  ],
  [
    "Property 1 starts at AED 10",
    { lang: "en", lane: "CHAT" },
    "no_legacy_property_formatter",
  ],
  [
    "I only speak English.",
    { lang: "en", lane: "CHAT" },
    "language_capability",
  ],
  ["Hello", { lang: "ar", lane: "CHAT" }, "arabic_response"],
  [
    "AED 900,000",
    { lang: "en", lane: "PROPERTY", propertiesFound: 0 },
    "no_price_without_inventory",
  ],
  [
    "Your key is sk-live-secret123456",
    { lang: "en", lane: "CHAT" },
    "no_platform_secret",
  ],
] as const)
  it("central gate rejects " + reason, () => {
    const r = new ResponseValidator().validate(text, route);
    expect(r.passed).toBe(false);
    expect(r.reason).toBe(reason);
  });
it("allows verified prices and Arabic when the inventory is present", () => {
  expect(
    new ResponseValidator().validate("شقة بسعر AED 900,000", {
      lang: "ar",
      lane: "PROPERTY",
      propertiesFound: 1,
    }).passed,
  ).toBe(true);
});
it("dry-run gate rejects English and Arabic action claims", () => {
  for (const text of ["I have booked your appointment.", "تم حجز الموعد"])
    expect(
      new ResponseValidator().validate(text, { lang: "en", lane: "CHAT" }, true)
        .reason,
    ).toBe("no_dry_run_action_claim");
});
it("unknown usage/rates remain null, while configured synthetic rates produce an estimate", () => {
  expect(estimatedCost("model", 100, 20)).toBeNull();
  expect(estimatedCost("model", null, 20, "{}")).toBeNull();
  expect(
    estimatedCost(
      "model",
      100,
      20,
      '{"model":{"inputPerMillion":2,"outputPerMillion":4}}',
    ),
  ).toBeCloseTo(0.00028);
  for (const config of [
    "invalid",
    '{"model":{"inputPerMillion":-1,"outputPerMillion":4}}',
    '{"model":{"inputPerMillion":"2","outputPerMillion":4}}',
  ])
    expect(estimatedCost("model", 100, 20, config)).toBeNull();
});
it("captures provider tokens and explicitly bounds SDK retries and timeouts", async () => {
  const r = await new ModelGateway().complete(request());
  expect(r.reply).toBe("Verified answer.");
  expect(r.attempts).toHaveLength(1);
  expect(r.attempts[0]).toMatchObject({
    inputTokens: 100,
    outputTokens: 20,
    outcome: "accepted",
    estimatedCostUSD: null,
  });
  expect(effects.options[0]).toMatchObject({ maxRetries: 0, timeout: 15000 });
});
it("repairs rejected drafts within the existing three-attempt bound", async () => {
  effects.anthropic
    .mockResolvedValueOnce({
      content: [{ type: "text", text: "I only speak English." }],
    })
    .mockResolvedValueOnce({ content: [{ type: "text", text: "Property 1" }] });
  const r = await new ModelGateway().complete(request());
  expect(r.attempts.map((a) => a.outcome)).toEqual([
    "validation_rejected",
    "validation_rejected",
    "accepted",
  ]);
  expect(effects.anthropic.mock.calls[2][0].system).toContain("CORRECTION");
});
it("falls back across providers only when the configured policy permits it", async () => {
  effects.anthropic.mockRejectedValue(Error("sk-private-do-not-store"));
  const r = await new ModelGateway().complete(request());
  expect(r.provider).toBe("groq");
  expect(JSON.stringify(r)).not.toContain("private");
  expect(r.attempts.map((a) => a.outcome)).toEqual([
    "provider_failed",
    "accepted",
  ]);
});
it("safe-response and explicit provider settings do not invoke the other provider", async () => {
  for (const policy of [
    { fallbackPolicy: "safe-response" as const },
    { provider: "anthropic" as const },
  ]) {
    effects.groq.mockClear();
    effects.anthropic.mockRejectedValue(Error("Unavailable"));
    const input = request();
    input.config.modelPolicy = { ...input.config.modelPolicy, ...policy };
    expect((await new ModelGateway().complete(input)).reply).toBe("");
    expect(effects.groq).not.toHaveBeenCalled();
  }
});
it("fast/economy automatic preference uses Groq first", async () => {
  const input = request();
  input.config.modelPolicy.latencyPreference = "fast";
  expect((await new ModelGateway().complete(input)).provider).toBe("groq");
  expect(effects.anthropic).not.toHaveBeenCalled();
});
it("missing provider infrastructure is recorded without invented token totals", async () => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("GROQ_API_KEY", "");
  const r = await new ModelGateway().complete(request());
  expect(r.reply).toBe("");
  expect(
    r.attempts.every(
      (a) => a.outcome === "unavailable" && a.inputTokens === null,
    ),
  ).toBe(true);
  expect(effects.anthropic).not.toHaveBeenCalled();
});
it("Studio claims become an honest side-effect-free preview and one recorded attempt", async () => {
  effects.anthropic.mockResolvedValue({
    content: [{ type: "text", text: "I booked the appointment." }],
  });
  const r = await new ModelGateway().complete({ ...request(), studio: true });
  expect(r.reply).toContain("No external action");
  expect(r.attempts).toHaveLength(1);
});
it("redacts secrets/email/phones/URLs while retaining numeric verified prices", () => {
  const text = redactEvidence(
    "Bearer private sk-secretvalue contact@example.invalid +971501234567 https://host.invalid/private",
  );
  expect(text).not.toMatch(/private|example|97150/);
  expect(
    safeEvidence({
      price: 1950000,
      phone: "+971501234567",
      prompt: "Private prompt",
    }),
  ).toEqual({ price: 1950000 });
});
it("memory captures only canonical bounded property criteria", () => {
  expect(
    safeCriteria({
      area: "Marina",
      maxBudget: 2e6,
      name: "Private name",
      phone: "+971500000000",
      note: "Do not store",
      excludeRefs: ["A-1"],
    }),
  ).toEqual({ area: "Dubai Marina", maxPrice: 2e6, excludeRefs: ["A-1"] });
});
it("parallel async trace contexts never mix tenant evidence", async () => {
  await Promise.all(
    ["A", "B"].map((orgId, i) =>
      executionTrace.run({ orgId, source: "helper" }, async () => {
        executionTrace.patch({ intent: orgId });
        await new Promise((r) => setTimeout(r, i ? 1 : 10));
        executionTrace.tool(
          "property.search",
          { maxPrice: i + 1 },
          { ids: [] },
        );
      }),
    ),
  );
  expect(effects.rows).toHaveLength(2);
  for (const row of effects.rows) {
    expect(row.evidence.intent).toBe(row.org_id);
    expect(row.evidence.toolCalls[0].parameters.maxPrice).toBe(
      row.org_id === "A" ? 1 : 2,
    );
  }
});
it("nested traces preserve the one root trace and reject a changed organization before work", async () => {
  await executionTrace.run({ orgId: "A", source: "helper" }, async () => {
    await executionTrace.run({ orgId: "A", source: "helper" }, async () =>
      executionTrace.patch({ intent: "same" }),
    );
    await expect(
      executionTrace.run({ orgId: "B", source: "helper" }, async () => {
        throw Error("Should not execute");
      }),
    ).rejects.toThrow("organization mismatch");
  });
  expect(effects.rows).toHaveLength(1);
});
it("trace failures remain structured and do not persist raw exception messages", async () => {
  await expect(
    executionTrace.run({ orgId: "A", source: "helper" }, async () => {
      throw Error("Customer private +971501234567");
    }),
  ).rejects.toThrow();
  expect(effects.rows[0]).toMatchObject({
    status: "failed",
    evidence: { failureReason: "EXECUTION_FAILED" },
  });
  expect(JSON.stringify(effects.rows)).not.toContain("Customer");
});
it("trace storage outage does not repeat or fail the completed customer operation", async () => {
  effects.storageFailure = true;
  const operation = vi.fn(async () => "completed customer result"),
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(
    await executionTrace.run({ orgId: "A", source: "helper" }, operation),
  ).toBe("completed customer result");
  expect(operation).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining("EXECUTION_TRACE_UNAVAILABLE"),
  );
  expect(log.mock.calls.flat().join(" ")).not.toContain("customer result");
});
