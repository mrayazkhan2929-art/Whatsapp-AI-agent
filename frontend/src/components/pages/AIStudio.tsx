"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ShieldCheck, ArrowLeft, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useAuthProfile } from "@/lib/use-auth-profile";
import { upgradeStudioConfig, type AgentConfig } from "@/lib/agent-studio";
import {
  StudioSections,
  StudioNavigation,
} from "@/components/studio/StudioSections";

type Config = AgentConfig;
interface Agent {
  id: string;
  name: string;
  active: boolean;
  publishedVersionId: string | null;
}
interface Draft {
  config: Config;
  revision: number;
  tested_revision: number | null;
}
interface Version {
  id: string;
  version_number: number;
  config: Config;
  published_at: string;
}
interface Review {
  diff: { field: string; before: unknown; after: unknown }[];
  warnings: string[];
}
interface Checks {
  tests: { name: string; passed: boolean }[];
  promptPreview: string;
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch("/api/agents" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok)
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : (payload.error?.message ?? "Agent operation failed"),
    );
  return payload.data as T;
}
const panel = "min-w-0 rounded-2xl border bg-card p-5 shadow-sm md:p-6";
const fieldLabels: Record<string, string> = {
  identity: "Assistant identity",
  instructions: "Instructions",
  languages: "Supported languages",
  modelPolicy: "Model & response style",
  knowledgeBaseIds: "Knowledge sources",
  defaultFlowId: "Compatibility flow",
  tools: "Knowledge retrieval",
};
const selectStyle =
  "mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm";
export function AIStudioList() {
  const router = useRouter();
  const { profile } = useAuthProfile();
  const canEdit = ["owner", "admin"].includes(profile?.role ?? "");
  const query = useQuery({
    queryKey: ["studio-agents"],
    queryFn: () => api<Agent[]>(""),
  });
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true);
    setError("");
    try {
      const config: Config = {
        schemaVersion: 1,
        identity: { name: name.trim() },
        instructions:
          "Help customers using verified company and property information.",
        languages: ["en", "ar"],
        modelPolicy: { provider: "auto", temperature: 0.7, maxTokens: 1000 },
        knowledgeBaseIds: [],
        defaultFlowId: null,
        tools: [],
      };
      const agent = await api<Agent>("", "POST", {
        name: name.trim(),
        config: upgradeStudioConfig(config),
      });
      router.push("/ai-studio/" + agent.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-center gap-3">
        <Bot className="h-10 w-10 rounded-xl bg-emerald-500/10 p-2 text-emerald-600" />
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">AI Studio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Shape your assistant. Test a draft. Publish with confidence.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Draft safely", "Edits stay separate from live replies."],
          [
            "Test before publishing",
            "Review configuration checks and differences.",
          ],
          ["Know what is live", "Every release has an immutable version."],
        ].map(([title, text]) => (
          <div key={title} className={panel}>
            <h2 className="font-medium">{title}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{text}</p>
          </div>
        ))}
      </div>
      {canEdit && (
        <form
          className={panel + " flex flex-wrap items-end gap-3"}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <label className="min-w-0 flex-1 text-sm font-medium">
            New assistant name
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              placeholder="Customer concierge"
              className="mt-2"
              required
            />
          </label>
          <Button disabled={busy || !name.trim()}>Create draft</Button>
        </form>
      )}
      {(error || query.error) && (
        <p role="alert" className="rounded-xl border p-4 text-sm text-red-600">
          {error || query.error?.message}
        </p>
      )}
      {query.isPending && <p role="status">Loading assistants…</p>}
      {query.data?.length === 0 && (
        <div className={panel + " text-center"}>
          <h2 className="font-medium">Your first assistant starts here</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Create a draft, give it an identity, then review its first release.
          </p>
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {query.data?.map((agent) => (
          <Link
            key={agent.id}
            href={"/ai-studio/" + agent.id}
            className={
              panel +
              " block hover:border-emerald-500/50 focus-visible:outline-2 focus-visible:outline-emerald-500"
            }
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-semibold">{agent.name}</h2>
              <Badge variant="secondary">
                {agent.publishedVersionId
                  ? agent.active
                    ? "Published"
                    : "Paused"
                  : "Draft only"}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Draft, release history and channel assignments →
            </p>
          </Link>
        ))}
      </div>
    </main>
  );
}
export function AIStudioDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ["studio-draft", id],
    queryFn: () => api<Draft>("/" + id + "/draft"),
    retry: false,
  });
  const agent = useQuery({
    queryKey: ["studio-agent", id],
    queryFn: () => api<Agent>("/" + id),
  });
  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <Link
        href="/ai-studio"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        All assistants
      </Link>
      {query.isPending && <p role="status">Loading workspace…</p>}
      {(query.error || agent.error) && (
        <p role="alert">{query.error?.message || agent.error?.message}</p>
      )}
      {query.data && agent.data && (
        <DraftEditor
          key={query.data.revision + ":" + agent.data.publishedVersionId}
          id={id}
          draft={query.data}
          agent={agent.data}
        />
      )}
    </main>
  );
}
function DraftEditor({
  id,
  draft,
  agent,
}: {
  id: string;
  draft: Draft;
  agent: Agent;
}) {
  const cache = useQueryClient();
  const { profile } = useAuthProfile();
  const canEdit = ["owner", "admin"].includes(profile?.role ?? "");
  const [config, setConfig] = useState(draft.config);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [checks, setChecks] = useState<Checks | null>(null);
  const [tested, setTested] = useState(
    draft.tested_revision === draft.revision,
  );
  const [deviceId, setDeviceId] = useState("");
  const [restore, setRestore] = useState<Version | null>(null);
  const dirty = JSON.stringify(config) !== JSON.stringify(draft.config);
  const versions = useQuery({
    queryKey: ["studio-versions", id],
    queryFn: () => api<Version[]>("/" + id + "/versions"),
  });
  const channels = useQuery({
    queryKey: ["studio-channels", id],
    queryFn: () => api<{ device_id: string }[]>("/" + id + "/channels"),
  });
  const devices = useQuery({
    queryKey: ["studio-devices"],
    queryFn: async () => {
      const response = await fetch("/api/devices");
      if (!response.ok) throw new Error("Devices could not be loaded");
      return (await response.json()).data as { id: string; name: string }[];
    },
  });
  const revision = {
    expectedRevision: draft.revision,
    expectedPublishedVersionId: agent.publishedVersionId,
  };
  function edit(next: Config) {
    setConfig(upgradeStudioConfig(next));
    setReview(null);
    setChecks(null);
    setTested(false);
    setNotice("");
  }
  async function run(
    action: string,
    path: string,
    body: unknown,
    method = "POST",
  ) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (action === "Validate")
        setReview(await api<Review>("/" + id + path, method, body));
      else if (action === "Test") {
        setChecks(await api<Checks>("/" + id + path, method, body));
        setTested(true);
        setReview(await api<Review>("/" + id + "/validate", "POST", {}));
      } else {
        await api("/" + id + path, method, body);
        await Promise.all(
          [
            "studio-draft",
            "studio-agent",
            "studio-versions",
            "studio-channels",
            "studio-agents",
            "studio-activity",
          ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
        );
        setRestore(null);
      }
      setNotice(action + " completed.");
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const published = versions.data?.find(
    (version) => version.id === agent.publishedVersionId,
  );
  return (
    <>
      <header id="overview" className="flex flex-wrap justify-between gap-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-emerald-600">
            Assistant workspace
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {agent.name}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Draft revision {draft.revision} ·{" "}
            {published
              ? "Live version " + published.version_number
              : "Ready for its first release"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">
            {dirty ? "Unsaved changes" : "Draft saved"}
          </Badge>
          <Badge variant="secondary">
            {agent.active && published ? "Live" : "Paused"}
          </Badge>
        </div>
      </header>
      <StudioNavigation id={id} />
      {(notice || error) && (
        <p
          role={error ? "alert" : "status"}
          className={
            "rounded-xl border p-4 text-sm " +
            (error ? "text-red-600" : "text-emerald-700")
          }
        >
          {error || notice}
        </p>
      )}
      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Review access. An owner or administrator can save and publish.
        </p>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <section className={panel + " space-y-5"}>
          <h2 className="font-semibold">Identity & instructions</h2>
          <p className="text-sm text-muted-foreground">
            Company facts and platform safety remain authoritative.
          </p>
          <fieldset disabled={!canEdit || busy} className="space-y-5">
            <label className="block text-sm font-medium">
              Assistant name
              <Input
                className="mt-2"
                value={config.identity.name}
                maxLength={120}
                onChange={(event) =>
                  edit({
                    ...config,
                    identity: { ...config.identity, name: event.target.value },
                  })
                }
              />
            </label>
            <label className="block text-sm font-medium">
              Instructions
              <Textarea
                aria-label="Instructions"
                className="mt-2 min-h-52 resize-y leading-relaxed"
                value={config.instructions}
                maxLength={12000}
                onChange={(event) =>
                  edit({ ...config, instructions: event.target.value })
                }
              />
              <span className="mt-2 block text-xs font-normal text-muted-foreground">
                Describe tone and tasks. Keep credentials out of instructions.
              </span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">
                Provider
                <select
                  className={selectStyle}
                  value={config.modelPolicy.provider}
                  onChange={(event) =>
                    edit({
                      ...config,
                      modelPolicy: {
                        ...config.modelPolicy,
                        provider: event.target
                          .value as Config["modelPolicy"]["provider"],
                      },
                    })
                  }
                >
                  <option value="auto">Automatic fallback</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="groq">Groq</option>
                </select>
              </label>
              <label className="text-sm font-medium">
                Response token limit
                <Input
                  className="mt-2"
                  type="number"
                  min={50}
                  max={8000}
                  value={config.modelPolicy.maxTokens}
                  onChange={(event) =>
                    edit({
                      ...config,
                      modelPolicy: {
                        ...config.modelPolicy,
                        maxTokens: Number(event.target.value),
                      },
                    })
                  }
                />
              </label>
            </div>
            <label className="block text-sm font-medium">
              Temperature · {config.modelPolicy.temperature}
              <input
                aria-label="Temperature"
                className="mt-3 block w-full accent-emerald-600"
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={config.modelPolicy.temperature}
                onChange={(event) =>
                  edit({
                    ...config,
                    modelPolicy: {
                      ...config.modelPolicy,
                      temperature: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <div>
              <p className="mb-2 text-sm font-medium">Supported languages</p>
              <div className="flex gap-5">
                {(["en", "ar"] as const).map((language) => (
                  <label
                    key={language}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={config.languages.includes(language)}
                      onChange={(event) =>
                        edit({
                          ...config,
                          languages: event.target.checked
                            ? [...config.languages, language]
                            : config.languages.filter(
                                (item) => item !== language,
                              ),
                        })
                      }
                    />
                    {language === "en" ? "English" : "Arabic"}
                  </label>
                ))}
              </div>
            </div>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!canEdit || busy || !dirty}
              onClick={() =>
                void run("Save", "/draft", { ...revision, config }, "PATCH")
              }
            >
              Save draft
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                void cache.invalidateQueries({
                  queryKey: ["studio-draft", id],
                });
                setConfig(draft.config);
                setReview(null);
                setChecks(null);
                setTested(false);
              }}
            >
              Reload saved draft
            </Button>
          </div>
        </section>
        <aside className="space-y-5">
          <section className={panel + " space-y-4"}>
            <h2 className="flex items-center gap-2 font-semibold">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              Release review
            </h2>
            <p className="text-sm text-muted-foreground">
              Save, validate and run checks. Review the differences before
              publishing.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy || dirty}
                onClick={() => void run("Validate", "/validate", {})}
              >
                Validate
              </Button>
              <Button
                variant="outline"
                disabled={!canEdit || busy || dirty}
                onClick={() => void run("Test", "/test", revision)}
              >
                Run checks
              </Button>
            </div>
            {review && (
              <div className="space-y-3">
                <p className="text-sm font-medium">
                  {
                    review.diff.filter(
                      (change) => change.field !== "schemaVersion",
                    ).length
                  }{" "}
                  changed fields
                </p>
                {review.diff
                  .filter((change) => change.field !== "schemaVersion")
                  .map((change) => (
                    <details
                      key={change.field}
                      className="rounded-lg border p-3 text-sm"
                    >
                      <summary className="cursor-pointer font-medium">
                        {fieldLabels[change.field] ?? change.field}
                      </summary>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Published
                      </p>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(change.before, null, 2)}
                      </pre>
                      <p className="mt-3 text-xs text-emerald-600">Draft</p>
                      <pre className="mt-1 whitespace-pre-wrap break-words text-xs">
                        {JSON.stringify(change.after, null, 2)}
                      </pre>
                    </details>
                  ))}
                {review.warnings.map((warning) => (
                  <p key={warning} className="text-xs text-muted-foreground">
                    {warning}
                  </p>
                ))}
              </div>
            )}
            {checks && (
              <div className="space-y-2">
                {checks.tests.map((test) => (
                  <p key={test.name} className="text-xs">
                    ✓ {test.name}
                  </p>
                ))}
                <p className="text-xs text-muted-foreground">
                  Deterministic configuration checks. No provider calls or
                  WhatsApp sends.
                </p>
                <details>
                  <summary className="cursor-pointer text-sm">
                    Effective instruction preview
                  </summary>
                  <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {checks.promptPreview}
                  </pre>
                </details>
              </div>
            )}
            <Button
              className="w-full"
              disabled={!canEdit || busy || dirty || !tested || !review}
              onClick={() => void run("Publish", "/publish", revision)}
            >
              Publish version
            </Button>
            <p className="text-xs text-muted-foreground">
              Publishing switches live configuration atomically. Replies already
              in progress may finish on their previous version.
            </p>
          </section>
          <section id="channels" className={panel + " space-y-4"}>
            <h2 className="flex items-center gap-2 font-semibold">
              <Radio className="h-5 w-5 text-emerald-600" />
              WhatsApp channels
            </h2>
            <p className="text-sm text-muted-foreground">
              Assign devices explicitly when you have multiple assistants.
            </p>
            {channels.data?.map((link) => (
              <div
                key={link.device_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted p-3 text-sm"
              >
                <span className="break-all">
                  {devices.data?.find((device) => device.id === link.device_id)
                    ?.name ?? link.device_id}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canEdit || busy}
                  onClick={() =>
                    void run(
                      "Remove channel",
                      "/channels/" + link.device_id,
                      undefined,
                      "DELETE",
                    )
                  }
                >
                  Remove channel
                </Button>
              </div>
            ))}
            {(channels.error || devices.error) && (
              <p role="alert" className="text-sm text-red-600">
                {channels.error?.message || devices.error?.message}
              </p>
            )}
            <label className="block text-sm">
              Device
              <select
                className={selectStyle}
                aria-label="Device" value={deviceId}
                disabled={!canEdit || busy}
                onChange={(event) => setDeviceId(event.target.value)}
              >
                <option value="">Select a device</option>
                {devices.data?.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              disabled={!canEdit || busy || !deviceId}
              onClick={() =>
                void run("Assign channel", "/channels", { deviceId })
              }
            >
              Assign to this assistant
            </Button>
          </section>
        </aside>
      </div>
      <StudioSections
        id={id}
        config={config}
        edit={edit}
        disabled={!canEdit || busy}
        revision={draft.revision}
      />
      <section id="versions" className={panel + " space-y-4"}>
        <h2 className="font-semibold">Version history</h2>
        <p className="text-sm text-muted-foreground">
          Published versions are immutable. Restoring one creates a new release.
        </p>
        {versions.error && <p role="alert">{versions.error.message}</p>}
        {versions.data?.length === 0 && (
          <p className="text-sm text-muted-foreground">No releases yet.</p>
        )}
        {versions.data?.map((version) => (
          <div
            key={version.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
          >
            <div>
              <span className="font-medium">
                Version {version.version_number}
              </span>
              {version.id === agent.publishedVersionId && (
                <Badge className="ml-3" variant="secondary">
                  Published pointer
                </Badge>
              )}
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(version.published_at).toLocaleString()}
              </p>
            </div>
            <div className="flex gap-3">
              <details>
                <summary className="cursor-pointer text-sm">
                  View snapshot
                </summary>
                <pre className="mt-3 max-w-xl whitespace-pre-wrap break-words text-xs">
                  {JSON.stringify(version.config, null, 2)}
                </pre>
              </details>
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || busy || dirty}
                onClick={() => setRestore(version)}
              >
                Review restore
              </Button>
            </div>
          </div>
        ))}
        {restore && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <h3 className="font-medium">
              Restore version {restore.version_number} as a new release
            </h3>
            <p className="mt-2 text-sm text-muted-foreground">
              This replaces the saved draft and publishes the historical
              configuration. Existing versions stay intact.
            </p>
            <pre className="my-4 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(restore.config, null, 2)}
            </pre>
            <div className="flex gap-2">
              <Button
                disabled={busy || dirty}
                onClick={() =>
                  void run(
                    "Restore",
                    "/versions/" + restore.id + "/rollback",
                    revision,
                  )
                }
              >
                Restore as new version
              </Button>
              <Button variant="outline" onClick={() => setRestore(null)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
      <div className="sticky bottom-3 z-20 flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-2xl border bg-background/95 p-4 shadow-lg backdrop-blur">
        <div><p className="text-sm font-medium">{dirty ? 'Unsaved configuration changes' : 'Configuration saved'}</p><p className="text-xs text-muted-foreground">Draft revision {draft.revision}. Validate and run checks before publishing.</p></div>
        {canEdit && <Button disabled={busy || !dirty} onClick={() => void run('Save', '/draft', { ...revision, config }, 'PATCH')}>Save configuration</Button>}
        {error && <p role="alert" className="w-full text-sm text-red-600">{error}</p>}
      </div>
    </>
  );
}
