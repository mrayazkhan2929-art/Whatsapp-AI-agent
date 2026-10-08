import Anthropic from "@anthropic-ai/sdk";
import Groq from "groq-sdk";
import type { AgentConfig } from "../config/AgentVersionService.js";
import {
  preferredProvider,
  selectedModel,
} from "../config/AgentStudioPolicy.js";
import { executionTrace } from "../observability/ExecutionTraceService.js";
import { responseValidator } from "./ResponseValidator.js";
import type { RouteResult } from "./router.js";

export interface ModelAttempt {
  provider: string;
  model: string;
  attempt: number;
  latencyMs: number;
  outcome: string;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedCostUSD: number | null;
  validationGates?: unknown;
  costBasis?: {
    inputPerMillion: number;
    outputPerMillion: number;
    currency: "USD";
  };
}
function configuredRates(model: string, ratesJSON?: string) {
  try {
    const rate = JSON.parse(ratesJSON ?? "{}")[model];
    if (
      !rate ||
      ![rate.inputPerMillion, rate.outputPerMillion].every(
        (v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
      )
    )
      return null;
    return {
      inputPerMillion: rate.inputPerMillion as number,
      outputPerMillion: rate.outputPerMillion as number,
      currency: "USD" as const,
    };
  } catch {
    return null;
  }
}
export function estimatedCost(
  model: string,
  input: number | null,
  output: number | null,
  ratesJSON = process.env.AI_COST_RATES_JSON,
): number | null {
  if (input === null || output === null || !ratesJSON) return null;
  const rate = configuredRates(model, ratesJSON);
  return rate
    ? (input * rate.inputPerMillion + output * rate.outputPerMillion) / 1000000
    : null;
}
const tokenCount = (value: unknown) =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
export class ModelGateway {
  async complete(input: {
    config: AgentConfig;
    system: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    route: Pick<RouteResult, "lang" | "lane" | "propertiesFound">;
    studio?: boolean;
  }) {
    const policy = input.config.modelPolicy,
      preferred = preferredProvider(policy);
    const chain =
      policy.provider === "auto" && policy.fallbackPolicy !== "safe-response"
        ? [preferred, preferred === "anthropic" ? "groq" : "anthropic"]
        : [preferred];
    const attempts: ModelAttempt[] = [];
    let system = input.system;
    for (const provider of chain) {
      const model = selectedModel(policy, provider as "anthropic" | "groq"),
        max = provider === "anthropic" && !input.studio ? 3 : 1;
      for (let attempt = 1; attempt <= max; attempt++) {
        const started = Date.now(),
          entry: ModelAttempt = {
            provider,
            model,
            attempt,
            latencyMs: 0,
            outcome: "unavailable",
            inputTokens: null,
            outputTokens: null,
            estimatedCostUSD: null,
          };
        let reply = "",
          retryRate = false;
        try {
          if (provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
            const result = await new Anthropic({
              apiKey: process.env.ANTHROPIC_API_KEY,
              timeout: 15000,
              maxRetries: 0,
            }).messages.create({
              model,
              max_tokens: policy.maxTokens,
              temperature: policy.temperature,
              system,
              messages: input.messages,
            });
            reply =
              result.content.find((block) => block.type === "text")?.text ?? "";
            entry.inputTokens = tokenCount(result.usage?.input_tokens);
            entry.outputTokens = tokenCount(result.usage?.output_tokens);
          } else if (provider === "groq" && process.env.GROQ_API_KEY) {
            const result = await new Groq({
              apiKey: process.env.GROQ_API_KEY,
              timeout: 12000,
              maxRetries: 0,
            }).chat.completions.create({
              model,
              ...(model.startsWith('openai/gpt-oss-')
                ? { max_completion_tokens: policy.maxTokens, include_reasoning: false, reasoning_effort: 'low' }
                : { max_tokens: policy.maxTokens }),
              temperature: policy.temperature,
              messages: [
                { role: "system", content: system },
                ...input.messages,
              ],
            });
            reply = result.choices[0]?.message?.content ?? "";
            entry.inputTokens = tokenCount(result.usage?.prompt_tokens);
            entry.outputTokens = tokenCount(result.usage?.completion_tokens);
          }
          entry.estimatedCostUSD = estimatedCost(
            model,
            entry.inputTokens,
            entry.outputTokens,
          );
          entry.costBasis =
            configuredRates(model, process.env.AI_COST_RATES_JSON) ?? undefined;
          const validation = responseValidator.validate(
            reply,
            input.route,
            input.studio,
          );
          entry.validationGates = validation.gates;
          entry.outcome = !reply
            ? entry.outcome
            : validation.passed
              ? "accepted"
              : "validation_rejected";
          if (validation.passed) {
            entry.latencyMs = Date.now() - started;
            attempts.push(entry);
            this.record(attempts, provider, model);
            return {
              reply,
              provider,
              model,
              attempts,
              fallback: attempts.length > 1,
            };
          }
          if (entry.outcome === "unavailable") break;
          if (input.studio && validation.reason === "no_dry_run_action_claim") {
            entry.latencyMs = Date.now() - started;
            attempts.push(entry);
            this.record(attempts, provider, model);
            return {
              reply:
                input.route.lang === "ar"
                  ? "هذه معاينة فقط. لم يتم تنفيذ أي إجراء خارجي."
                  : "This is a preview. No external action was performed.",
              provider,
              model,
              attempts,
              fallback: true,
            };
          }
          system +=
            "\n\nCORRECTION: Your previous draft failed validation (" +
            validation.reason +
            "). Fix it completely.";
        } catch (error) {
          entry.outcome =
            (error as { status?: number })?.status === 429
              ? "rate_limited"
              : "provider_failed";
          retryRate = entry.outcome === "rate_limited" && attempt < max;
        } finally {
          entry.latencyMs = Date.now() - started;
          if (!attempts.includes(entry)) attempts.push(entry);
        }
        if (retryRate)
          await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        else if (
          entry.outcome === "provider_failed" ||
          entry.outcome === "unavailable"
        )
          break;
      }
    }
    this.record(attempts, "none", "none");
    return {
      reply: "",
      provider: "none",
      model: "none",
      attempts,
      fallback: true,
    };
  }
  private record(attempts: ModelAttempt[], provider: string, model: string) {
    const complete = attempts.every(
      (a) => a.inputTokens !== null && a.outputTokens !== null,
    );
    executionTrace.patch({
      provider,
      model,
      providerAttempts: attempts,
      tokens:
        complete && attempts.length
          ? {
              input: attempts.reduce((n, a) => n + a.inputTokens!, 0),
              output: attempts.reduce((n, a) => n + a.outputTokens!, 0),
            }
          : null,
      estimatedCostUSD:
        attempts.length && attempts.every((a) => a.estimatedCostUSD !== null)
          ? attempts.reduce((n, a) => n + a.estimatedCostUSD!, 0)
          : null,
      validationGates: attempts.flatMap((a) => a.validationGates ?? []),
      fallback: attempts.length > 1 || provider === "none",
    });
  }
}
export const modelGateway = new ModelGateway();
