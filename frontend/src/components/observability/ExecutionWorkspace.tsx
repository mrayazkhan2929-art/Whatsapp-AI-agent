"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuthProfile } from "@/lib/use-auth-profile";
import { Button } from "@/components/ui/button";
type Trace = {
  id: string;
  source: string;
  status: string;
  created_at: string;
  device_id: string | null;
  conversation_id: string | null;
  inbound_message_id: string | null;
  outbound_message_id: string | null;
  agent_id: string | null;
  agent_version_id: string | null;
  evidence: Record<string, unknown>;
};
async function api(path: string) {
  const response = await fetch("/api/observability/" + path, {
    cache: "no-store",
  });
  const payload = await response.json();
  if (!response.ok)
    throw Error(payload.error ?? "Could not load execution evidence");
  return payload;
}
const card = "min-w-0 rounded-2xl border bg-card p-5 shadow-sm";
function Evidence({ value }: { value: unknown }) {
  return (
    <pre
      dir="ltr"
      className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-xs"
    >
      {JSON.stringify(value ?? "Not recorded", null, 2)}
    </pre>
  );
}
function Access({ children }: { children: React.ReactNode }) {
  const auth = useAuthProfile();
  if (auth.isPending)
    return (
      <p role="status" className="p-6">
        Loading access…
      </p>
    );
  if (auth.isError)
    return (
      <p role="alert" className="p-6">
        Could not verify your access.
      </p>
    );
  if (!["owner", "admin"].includes(auth.profile?.role ?? ""))
    return (
      <p role="alert" className="p-6">
        Only owners and administrators can inspect execution evidence.
      </p>
    );
  return <>{children}</>;
}
export function ExecutionWorkspace({ agentId }: { agentId?: string }) {
  return (
    <Access>
      <TraceList agentId={agentId} />
    </Access>
  );
}
function TraceList({ agentId }: { agentId?: string }) {
  const [status, setStatus] = useState(""),
    [cursor, setCursor] = useState(""),
    [audit, setAudit] = useState(false);
  const query = useQuery({
    queryKey: ["execution-history", agentId, status, cursor, audit],
    queryFn: () =>
      api(
        audit
          ? "audit?limit=30" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : "")
          : "traces?limit=30" +
              (agentId ? "&agentId=" + encodeURIComponent(agentId) : "") +
              (status ? "&status=" + status : "") +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
      ),
    retry: false,
  });
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-widest text-teal-700">
            Execution evidence
          </p>
          <h1 className="mt-2 text-2xl font-semibold">
            {audit ? "Action audit" : "Why this reply?"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Review routing, verified sources, model attempts and delivery
            outcomes.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setAudit(!audit);
            setCursor("");
          }}
        >
          {audit ? "View executions" : "View action audit"}
        </Button>
      </div>
      <div className={card + " flex flex-wrap items-center gap-4"}>
        <label className="text-sm">
          Outcome
          <select
            className="ms-3 rounded-lg border bg-background p-2"
            disabled={audit}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setCursor("");
            }}
          >
            <option value="">All outcomes</option>
            {["completed", "failed", "skipped"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <Button
          variant="ghost"
          onClick={() => {
            setCursor("");
            void query.refetch();
          }}
        >
          Refresh
        </Button>
        <p className="text-xs text-muted-foreground">
          Raw messages and prompts are excluded. Unknown token usage and cost
          stay unavailable.
        </p>
      </div>
      {query.isPending ? (
        <p role="status">Loading history…</p>
      ) : query.isError ? (
        <p role="alert" className={card}>
          {query.error.message}
        </p>
      ) : (
        <>
          <div className="space-y-3">
            {query.data.data.length === 0 ? (
              <p className={card}>
                No retained {audit ? "audit events" : "executions"} match this
                view.
              </p>
            ) : (
              query.data.data.map(
                (
                  row: Trace & {
                    action: string;
                    resource_type: string;
                    outcome: string;
                    details: unknown;
                  },
                ) => (
                  <article key={row.id} className={card}>
                    <div className="flex flex-wrap justify-between gap-3">
                      <div>
                        {audit ? (
                          <h2 className="font-semibold">{row.action}</h2>
                        ) : (
                          <Link
                            className="font-semibold text-teal-700 underline focus-visible:outline-2"
                            href={"/execution-traces/" + row.id}
                          >
                            {String(row.evidence.intent ?? "Unclassified turn")}{" "}
                            · {row.status}
                          </Link>
                        )}
                        <p className="mt-1 text-sm text-muted-foreground">
                          {new Date(row.created_at).toLocaleString()} ·{" "}
                          {audit ? row.outcome : row.source}
                        </p>
                      </div>
                      {!audit && (
                        <p className="text-sm">
                          {String(row.evidence.language ?? "—")} ·{" "}
                          {String(row.evidence.provider ?? "No model call")}
                        </p>
                      )}
                    </div>
                    <p
                      dir="ltr"
                      className="mt-2 break-all text-xs text-muted-foreground"
                    >
                      {row.id}
                    </p>
                    {audit && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-sm">
                          Action details
                        </summary>
                        <Evidence value={row.details} />
                      </details>
                    )}
                  </article>
                ),
              )
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor("")}
            >
              Newest
            </Button>
            <Button
              variant="outline"
              disabled={!query.data.nextCursor}
              onClick={() => setCursor(query.data.nextCursor)}
            >
              Older records
            </Button>
          </div>
        </>
      )}
    </main>
  );
}
export function ExecutionDetail({
  id,
  message = false,
}: {
  id: string;
  message?: boolean;
}) {
  return (
    <Access>
      <TraceDetail id={id} message={message} />
    </Access>
  );
}
function TraceDetail({ id, message }: { id: string; message: boolean }) {
  const query = useQuery<{ data: Trace }>({
    queryKey: ["execution-detail", id, message],
    queryFn: () =>
      api((message ? "messages/" : "traces/") + encodeURIComponent(id)),
    retry: false,
  });
  if (query.isPending)
    return (
      <p role="status" className="p-6">
        Loading execution…
      </p>
    );
  if (query.isError)
    return (
      <main className="space-y-4 p-6">
        <Link href="/execution-traces" className="text-teal-700 underline">
          Execution history
        </Link>
        <p role="alert">{query.error.message}</p>
        <Button variant="outline" onClick={() => void query.refetch()}>
          Retry evidence lookup
        </Button>
      </main>
    );
  const trace = query.data.data,
    e = trace.evidence;
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-7">
      <Link
        href="/execution-traces"
        className="text-sm text-teal-700 underline"
      >
        Back to execution history
      </Link>
      <h1 className="text-2xl font-semibold">Why this reply?</h1>
      <div className={card}>
        <div className="flex flex-wrap justify-between gap-3">
          <p className="font-semibold">
            {String(e.intent ?? "Unclassified")} · {trace.status}
          </p>
          <p className="text-sm text-muted-foreground">
            {new Date(trace.created_at).toLocaleString()}
          </p>
        </div>
        <p dir="ltr" className="mt-2 break-all text-xs">
          Trace ID: {trace.id}
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          This is retained execution evidence. Message text is redacted;
          historical turns cannot be reconstructed from current settings.
        </p>
        <p dir="auto" className="mt-4 whitespace-pre-wrap break-words text-sm">
          {String(
            (e.finalResult as { replyPreview?: string })?.replyPreview ??
              "No AI reply was generated.",
          )}
        </p>
      </div>
      <div className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          ["Language", e.language],
          ["Confidence", e.confidence],
          [
            "Provider / model",
            [e.provider ?? "none", e.model ?? "none"].join(" / "),
          ],
          [
            "Latency",
            typeof e.latencyMs === "number"
              ? e.latencyMs + " ms"
              : "Unavailable",
          ],
          ["Tokens", e.tokens ? JSON.stringify(e.tokens) : "Unavailable"],
          [
            "Estimated cost",
            typeof e.estimatedCostUSD === "number"
              ? "USD " + e.estimatedCostUSD.toFixed(6)
              : "Unavailable · rates or usage missing",
          ],
        ].map(([label, value]) => (
          <section className={card} key={String(label)}>
            <h2 className="text-xs text-muted-foreground">{String(label)}</h2>
            <p dir="auto" className="mt-2 break-all text-sm font-medium">
              {String(value ?? "Not recorded")}
            </p>
          </section>
        ))}
      </div>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-2">
        {[
          [
            "Routing and entities",
            { intent: e.intent, reason: e.routingReason, entities: e.entities },
          ],
          ["Tools and verified results", e.toolCalls],
          [
            "Property query",
            {
              query: e.propertyQuery,
              ids: e.propertyIds,
              quality: e.matchQuality,
              reason: e.propertyReason,
            },
          ],
          [
            "Knowledge provenance",
            { sources: e.knowledgeSources, retrieval: e.retrieval },
          ],
          ["Provider attempts", e.providerAttempts],
          ["Validation gates", e.validationGates],
          [
            "Memory before / after",
            { before: e.memoryBefore, after: e.memoryAfter },
          ],
          [
            "Fallback and handoff",
            {
              fallback: e.fallback,
              handoff: e.handoffDecision,
              failure: e.failureReason,
              transport: e.transport,
            },
          ],
          [
            "Context identifiers",
            {
              device: trace.device_id,
              agent: trace.agent_id,
              version: trace.agent_version_id,
              conversation: trace.conversation_id,
              inbound: trace.inbound_message_id,
              outbound: trace.outbound_message_id,
            },
          ],
          ["Final result", e.finalResult],
        ].map(([label, value]) => (
          <section key={String(label)} className={card}>
            <h2 className="font-semibold">{String(label)}</h2>
            <Evidence value={value} />
          </section>
        ))}
      </div>
    </main>
  );
}
