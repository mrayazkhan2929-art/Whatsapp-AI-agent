import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "../../config/supabase.js";
import { safeCriteria, safeEvidence, textDigest } from "./TracePrivacy.js";
import type { ReplyResult } from "../ai/aiService.js";

export interface TraceScope {
  orgId: string;
  source: "http" | "whatsapp" | "helper";
  deviceId?: string;
  conversationId?: string;
  inboundMessageId?: string;
}
export interface TraceContext extends TraceScope {
  id: string;
  started: number;
  agentId?: string;
  agentVersionId?: string;
  outboundMessageId?: string;
  status: "completed" | "failed" | "skipped";
  evidence: Record<string, unknown>;
}
const storage = new AsyncLocalStorage<TraceContext>();
export class ExecutionTraceService {
  current() {
    return storage.getStore();
  }
  patch(evidence: Record<string, unknown>) {
    const ctx = this.current();
    if (ctx) Object.assign(ctx.evidence, safeEvidence(evidence));
  }
  identify(
    ids: Partial<
      Pick<
        TraceContext,
        | "deviceId"
        | "conversationId"
        | "inboundMessageId"
        | "outboundMessageId"
        | "agentId"
        | "agentVersionId"
      >
    >,
  ) {
    const ctx = this.current();
    if (ctx) Object.assign(ctx, ids);
  }
  tool(name: string, parameters: unknown, result: unknown) {
    const ctx = this.current();
    if (ctx) {
      const calls = (ctx.evidence.toolCalls ?? []) as unknown[];
      if (calls.length < 50)
        calls.push(safeEvidence({ name, parameters, result }));
      ctx.evidence.toolCalls = calls;
    }
  }
  outcome(status: TraceContext["status"], reason?: string) {
    const ctx = this.current();
    if (ctx) {
      ctx.status = status;
      if (reason)
        ctx.evidence.failureReason = /^[A-Z0-9_]{1,80}$/.test(reason)
          ? reason
          : "EXECUTION_FAILED";
    }
  }
  reply(result: ReplyResult) {
    this.identify({ agentVersionId: result.agentVersionId });
    this.patch({
      language: result.lang,
      intent: result.lane,
      fallback:
        result.replyMode === "fallback" ||
        this.current()?.evidence.fallback === true,
      handoffDecision: result.handoff ? "requested" : "none",
      knowledgeSources: result.retrievalTrace?.hits ?? [],
      retrieval: result.retrievalTrace,
      finalResult: {
        replyPreview: result.reply,
        replySHA256: textDigest(result.reply),
        mode: result.replyMode,
      },
    });
  }
  async run<T>(scope: TraceScope, handler: () => Promise<T>): Promise<T> {
    const existing = this.current();
    if (existing) {
      if (existing.orgId !== scope.orgId)
        throw new Error("Trace organization mismatch");
      return handler();
    }
    const context: TraceContext = {
      ...scope,
      id: randomUUID(),
      started: Date.now(),
      status: "completed",
      evidence: {
        toolCalls: [],
        providerAttempts: [],
        validationGates: [],
        tokens: null,
        estimatedCostUSD: null,
      },
    };
    return storage.run(context, async () => {
      try {
        return await handler();
      } catch (error) {
        this.outcome(
          "failed",
          (error as { code?: string })?.code ?? "EXECUTION_FAILED",
        );
        throw error;
      } finally {
        context.evidence.latencyMs = Date.now() - context.started;
        if (isSupabaseConfigured()) {
          try {
            const evidence = safeEvidence(context.evidence);
            if (Buffer.byteLength(JSON.stringify(evidence)) > 60000)
              throw new Error("Evidence limit");
            const { error } = await getSupabaseAdmin()
              .from("execution_traces")
              .insert({
                id: context.id,
                org_id: context.orgId,
                source: context.source,
                device_id: context.deviceId ?? null,
                conversation_id: context.conversationId ?? null,
                inbound_message_id: context.inboundMessageId ?? null,
                outbound_message_id: context.outboundMessageId ?? null,
                agent_id: context.agentId ?? null,
                agent_version_id: context.agentVersionId ?? null,
                status: context.status,
                evidence,
              });
            if (error) throw new Error("Trace storage failed");
          } catch {
            console.error(
              JSON.stringify({
                tag: "EXECUTION_TRACE_UNAVAILABLE",
                traceId: context.id,
              }),
            );
          }
        }
      }
    });
  }
  memory(
    value: Record<string, unknown>,
    stage: "memoryBefore" | "memoryAfter",
  ) {
    this.patch({ [stage]: safeCriteria(value) });
  }
}
export const executionTrace = new ExecutionTraceService();
