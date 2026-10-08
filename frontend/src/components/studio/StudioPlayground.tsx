"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { studioApi } from "@/lib/agent-studio";
type Run = {
  traceId: string;
  draftRevision: number;
  agentVersion: string;
  detectedLanguage: string;
  responseLanguage: string;
  detectedIntent: string;
  extractedEntities: unknown;
  conversationState: { criteria: unknown };
  toolsSelected: unknown;
  propertyQuery: unknown;
  retrievedProperties: unknown;
  knowledgeSources: unknown;
  model: string;
  validation: string[];
  finalResponse: string;
  mode: string;
  sideEffects: unknown;
};
const panel = "min-w-0 rounded-2xl border bg-card p-5 space-y-4";
export function PlaygroundPanel({
  id,
  revision,
  canEdit,
}: {
  id: string;
  revision: number;
  canEdit: boolean;
}) {
  const cache = useQueryClient(),
    [message, setMessage] = useState(""),
    [state, setState] = useState<unknown>({ excludeRefs: [] }),
    [mode, setMode] = useState("preview"),
    [run, setRun] = useState<Run | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function test() {
    setBusy(true);
    setError("");
    try {
      const result = await studioApi<Run>(id, "/playground", "POST", {
        expectedRevision: revision,
        message,
        state,
        mode,
      });
      setRun(result);
      setState(result.conversationState.criteria);
      void cache.invalidateQueries({ queryKey: ["studio-traces", id] });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="test-playground" className={panel}>
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <h2 className="font-semibold">Test Playground</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tests the saved draft. Live replies and customer records stay
            separate.
          </p>
        </div>
        <Link
          href={"/ai-studio/" + id + "/traces"}
          className="text-sm text-teal-700 underline"
        >
          Review test traces
        </Link>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void test();
        }}
        className="space-y-3"
      >
        <label className="block text-sm">
          User Message
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={2000}
            dir="auto"
            className="mt-2"
            required
            disabled={!canEdit || busy}
          />
        </label>
        <label className="block text-sm">
          Test mode
          <select
            className="mt-2 block w-full rounded-lg border bg-background p-2"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            disabled={!canEdit || busy}
          >
            <option value="preview">Safe preview · no provider call</option>
            <option value="model">
              Model draft · provider call, simulated actions
            </option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!canEdit || busy || !message.trim()}>
            {busy ? "Testing…" : "Run draft test"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setState({ excludeRefs: [] });
              setRun(null);
            }}
          >
            Reset test conversation
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Draft revision {revision}. Safe preview uses real inventory and
          lexical knowledge reads. Booking, contact edits and WhatsApp delivery
          are simulated. Model mode may use platform provider credits.
        </p>
      </form>
      {!canEdit && (
        <p className="text-sm">
          An owner or administrator can run draft tests.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 p-3 text-sm text-red-600"
        >
          {error}
        </p>
      )}
      {run && <PlaygroundResult run={run} />}
    </section>
  );
}
export function PlaygroundResult({
  run,
}: {
  run: Omit<Run, "traceId"> & { traceId?: string };
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-teal-50/40 p-4 dark:bg-teal-950/20">
        <h3 className="text-sm font-medium">Final Response</h3>
        <p
          role="status"
          dir="auto"
          className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed"
        >
          {run.finalResponse}
        </p>
      </div>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {[
          ["Detected Language", run.detectedLanguage],
          ["Detected Intent", run.detectedIntent],
          ["Agent Version", run.agentVersion],
          ["Model", run.model],
        ].map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p dir="ltr" className="mt-1 break-all text-sm">
              {value}
            </p>
          </div>
        ))}
      </div>
      {[
        ["Extracted Entities", run.extractedEntities],
        ["Conversation State", run.conversationState],
        ["Tools Selected", run.toolsSelected],
        ["Property Query", run.propertyQuery],
        ["Retrieved Properties", run.retrievedProperties],
        ["Knowledge Sources", run.knowledgeSources],
        ["Validation", run.validation],
        ["Side effects", run.sideEffects],
      ].map(([label, value]) => (
        <details key={String(label)} className="min-w-0 rounded-xl border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {String(label)}
          </summary>
          <pre
            dir="ltr"
            className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs"
          >
            {JSON.stringify(value, null, 2)}
          </pre>
        </details>
      ))}
      {run.traceId && (
        <p className="break-all text-xs text-muted-foreground">
          Trace ID: <bdi dir="ltr">{run.traceId}</bdi>
        </p>
      )}
    </div>
  );
}
export function StudioInspector({
  id,
  view,
}: {
  id: string;
  view: "test" | "versions" | "traces";
}) {
  const draft = useQuery({
      queryKey: ["studio-draft", id],
      retry: false,
      queryFn: () => studioApi<{ revision: number }>(id, "/draft"),
    }),
    auth = useQuery({
      queryKey: ["studio-inspector-auth"],
      queryFn: async () => {
        const r = await fetch("/api/auth/me");
        if (!r.ok) throw Error("Authentication unavailable");
        return (await r.json()).data as { role: string };
      },
    });
  const entries = useQuery({
    queryKey: [view === "traces" ? "studio-traces" : "studio-versions", id],
    enabled: view !== "test",
    retry: false,
    queryFn: () =>
      studioApi<
        Array<{
          id: string;
          draft_revision?: number;
          version_number?: number;
          summary?: Run;
          config?: unknown;
          created_at?: string;
          published_at?: string;
        }>
      >(id, view === "traces" ? "/traces" : "/versions"),
  });
  const [search, setSearch] = useState("");
  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link
        href={"/ai-studio/" + id}
        className="text-sm text-teal-700 underline"
      >
        Back to assistant workspace
      </Link>
      <Link href={"/ai-studio/"+id+"/executions"} className="ms-4 text-sm text-teal-700 underline">Production executions</Link>
      <h1 className="text-2xl font-semibold">
        {view === "test"
          ? "Draft Test Playground"
          : view === "versions"
            ? "Versions"
            : "Activity & test traces"}
      </h1>
      {(draft.error || entries.error || auth.error) && (
        <p role="alert">
          {draft.error?.message ||
            entries.error?.message ||
            auth.error?.message}
        </p>
      )}
      {(draft.isPending || (view !== "test" && entries.isPending)) && (
        <p role="status">Loading workspace…</p>
      )}
      {view === "test" && draft.data && (
        <PlaygroundPanel
          id={id}
          revision={draft.data.revision}
          canEdit={["owner", "admin"].includes(auth.data?.role ?? "")}
        />
      )}{" "}
      {view !== "test" && entries.data && (
        <section className={panel}>
          <p className="text-sm text-muted-foreground">
            {view === "traces"
              ? "Saved draft test artifacts. Open production executions to inspect live reply evidence."
              : "Immutable releases. Restore a snapshot as a new release from the assistant workspace."}
          </p>
          <label className="block text-sm">
            Filter history
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mt-2"
            />
          </label>
          {!entries.data.length && (
            <p className="text-sm">
              No {view === "traces" ? "draft tests" : "releases"} yet.
            </p>
          )}
          {entries.data
            .filter((e) =>
              JSON.stringify(e).toLowerCase().includes(search.toLowerCase()),
            )
            .map((e) => (
              <details key={e.id} className="min-w-0 rounded-xl border p-4">
                <summary className="cursor-pointer text-sm">
                  {view === "traces"
                    ? "Draft " +
                      e.draft_revision +
                      " · " +
                      e.summary?.detectedIntent
                    : "Version " + e.version_number}
                  <span className="ms-3 text-xs text-muted-foreground">
                    {new Date(
                      e.created_at ?? e.published_at ?? 0,
                    ).toLocaleString()}
                  </span>
                </summary>
                <div className="mt-4">
                  {e.summary ? (
                    <PlaygroundResult run={{ ...e.summary, traceId: e.id }} />
                  ) : (
                    <pre
                      dir="ltr"
                      className="overflow-auto whitespace-pre-wrap break-all text-xs"
                    >
                      {JSON.stringify(e.config, null, 2)}
                    </pre>
                  )}
                </div>
              </details>
            ))}
        </section>
      )}
    </div>
  );
}
