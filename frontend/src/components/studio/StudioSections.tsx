"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  upgradeStudioConfig,
  instructionLabels,
  studioTools,
  studioApi,
  type AgentConfig,
} from "@/lib/agent-studio";
import { PlaygroundPanel } from "./StudioPlayground";
const panel = "min-w-0 space-y-4 rounded-2xl border bg-card p-5 shadow-sm";
const grid = "grid min-w-0 gap-4 sm:grid-cols-2";
const select = "mt-2 block w-full rounded-lg border bg-background p-2 text-sm";
async function resources(path: string) {
  const r = await fetch("/api/" + path);
  if (!r.ok) throw Error("Could not load " + path);
  return (await r.json()).data;
}
export function StudioNavigation({ id }: { id: string }) {
  return (
    <nav
      aria-label="Assistant sections"
      className="flex flex-wrap gap-2 rounded-2xl border bg-card p-3"
    >
      {[
        "Overview",
        "Identity",
        "Instructions",
        "Company Profile inheritance",
        "Knowledge",
        "Property Behavior",
        "Tools",
        "Human Handoff",
        "Model",
        "Channels",
        "Test Playground",
        "Versions",
        "Activity",
      ].map((label) => (
        <Link
          key={label}
          href={
            label === "Test Playground"
              ? "/ai-studio/" + id + "/test"
              : label === "Versions"
                ? "/ai-studio/" + id + "/versions"
                : label === "Activity"
                  ? "/ai-studio/" + id + "/traces"
                  : "#" + label.toLowerCase().replaceAll(" ", "-")
          }
          className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-teal-50 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-teal-600 dark:hover:bg-teal-950"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function StudioSections({
  id,
  config,
  edit,
  disabled,
  revision,
}: {
  id: string;
  config: AgentConfig;
  edit: (c: AgentConfig) => void;
  disabled: boolean;
  revision: number;
}) {
  const c = upgradeStudioConfig(config),
    identity = c.identity,
    policy = c.propertyPolicy!,
    handoff = c.handoffPolicy!;
  const bases = useQuery({
      queryKey: ["studio-knowledge"],
      queryFn: () => resources("knowledge-bases"),
    }),
    team = useQuery({
      queryKey: ["studio-team"],
      queryFn: () => resources("team"),
    }),
    flows = useQuery({
      queryKey: ["studio-flows"],
      queryFn: () => resources("flows"),
    }),
    company = useQuery({
      queryKey: ["studio-company"],
      queryFn: () => resources("settings/company-profile"),
    });
  const activity = useQuery({
    queryKey: ["studio-activity", id],
    queryFn: () =>
      studioApi<
        Array<{
          id: string;
          action: string;
          created_at: string;
          details: unknown;
        }>
      >(id, "/activity"),
  });
  const setIdentity = (key: keyof AgentConfig["identity"], value: string) =>
    edit({ ...c, identity: { ...identity, [key]: value } });
  const selectField = (
    label: string,
    value: string,
    choices: readonly string[],
    change: (s: string) => void,
  ) => (
    <label className="block min-w-0 text-sm">
      {label}
      <select
        className={select}
        value={value}
        onChange={(e) => change(e.target.value)}
      >
        {choices.map((s) => (
          <option key={s} value={s}>
            {s.replaceAll("-", " ")}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <>
      <div className="grid min-w-0 items-start gap-5 lg:grid-cols-2">
        <section id="identity" className={panel}>
          <h2 className="font-semibold">Identity</h2>
          <p className="text-sm text-muted-foreground">
            How the assistant presents itself and guides a conversation.
          </p>
          <fieldset disabled={disabled} className="space-y-4">
            <div className={grid}>
              {(
                [
                  "displayName",
                  "role",
                  "persona",
                  "description",
                  "avatar",
                ] as const
              ).map((key) => (
                <label key={key} className="min-w-0 text-sm">
                  {
                    {
                      displayName: "Display name",
                      role: "Assistant role",
                      persona: "Persona",
                      description: "Description",
                      avatar: "Avatar URL",
                    }[key]
                  }
                  <Input
                    dir={key === "avatar" ? "ltr" : "auto"}
                    className="mt-2"
                    value={identity[key] ?? ""}
                    maxLength={key === "avatar" ? 1000 : 2000}
                    onChange={(e) => setIdentity(key, e.target.value)}
                  />
                </label>
              ))}
              {selectField(
                "Default language",
                identity.defaultLanguage ?? c.languages[0],
                c.languages,
                (s) => setIdentity("defaultLanguage", s),
              )}
            </div>
            <div className={grid}>
              {Object.entries({
                tone: ["calm", "friendly", "professional"],
                formality: ["casual", "balanced", "formal"],
                responseLength: ["short", "balanced", "detailed"],
                emojiStyle: ["none", "subtle", "expressive"],
                salesStyle: ["consultative", "informative", "direct"],
                conversationStyle: ["one-question", "guided", "conversational"],
                greetingBehavior: ["brief", "introduce", "none"],
              }).map(([key, choices]) => (
                <div key={key}>
                  {selectField(
                    key.replace(/([A-Z])/g, " $1"),
                    String(
                      identity[key as keyof typeof identity] ?? choices[0],
                    ),
                    choices,
                    (s) => setIdentity(key as keyof typeof identity, s),
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        </section>
        <section id="instructions" className={panel}>
          <h2 className="font-semibold">Business instructions</h2>
          <p className="text-sm text-muted-foreground">
            Tenant guidance operates below platform safety and verified company
            facts.
          </p>
          <fieldset disabled={disabled} className="space-y-3">
            {Object.entries(instructionLabels).map(([key, label]) => (
              <details key={key} className="rounded-xl border p-3">
                <summary className="cursor-pointer text-sm">
                  {label}
                  {c.instructionPolicy![key as keyof typeof instructionLabels]
                    ? " · configured"
                    : ""}
                </summary>
                <label className="mt-3 block text-sm">
                  {label}
                  <Textarea
                    dir="auto"
                    className="mt-2"
                    maxLength={2000}
                    value={
                      c.instructionPolicy![
                        key as keyof typeof instructionLabels
                      ]
                    }
                    onChange={(e) =>
                      edit({
                        ...c,
                        instructionPolicy: {
                          ...c.instructionPolicy!,
                          [key]: e.target.value,
                        },
                      })
                    }
                  />
                </label>
              </details>
            ))}
          </fieldset>
        </section>
        <section id="company-profile-inheritance" className={panel}>
          <h2 className="font-semibold">Company Profile inheritance</h2>
          <p className="text-sm">
            Verified company facts are inherited automatically and cannot be
            overridden by assistant instructions.
          </p>
          {company.isPending && <p role="status">Loading company profile…</p>}
          {company.error && (
            <p role="alert" className="text-sm text-red-600">
              {company.error.message}
            </p>
          )}
          {company.data ? (
            <details>
              <summary className="cursor-pointer text-sm">
                Review inherited company facts
              </summary>
              <pre
                dir="ltr"
                className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs"
              >
                {JSON.stringify(company.data, null, 2)}
              </pre>
            </details>
          ) : (
            !company.isPending && (
              <p className="text-sm text-muted-foreground">
                Company profile is not configured.
              </p>
            )
          )}
          <Link
            href="/settings"
            className="inline-block text-sm text-teal-700 underline"
          >
            Manage company profile
          </Link>
        </section>
        <section id="knowledge" className={panel}>
          <h2 className="font-semibold">Knowledge</h2>
          <p className="text-sm text-muted-foreground">
            Select this assistant's permitted sources. Disabled and deleted
            documents stay excluded.
          </p>
          {bases.error && <p role="alert">{bases.error.message}</p>}
          <fieldset disabled={disabled} className="space-y-3">
            {(bases.data ?? []).map(
              (kb: { id: string; name: string; chunkCount: number }) => (
                <label
                  key={kb.id}
                  className="flex gap-3 rounded-xl border p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={c.knowledgeBaseIds.includes(kb.id)}
                    onChange={(e) => {
                      const ids = e.target.checked
                        ? [...c.knowledgeBaseIds, kb.id]
                        : c.knowledgeBaseIds.filter((x) => x !== kb.id);
                      edit({
                        ...c,
                        knowledgeBaseIds: ids,
                        tools: ids.length
                          ? [
                              ...new Set([
                                ...c.tools,
                                "knowledge.search" as const,
                              ]),
                            ]
                          : c.tools,
                      });
                    }}
                  />
                  <span className="min-w-0 break-words">
                    {kb.name}
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {kb.chunkCount} retained chunks
                    </span>
                  </span>
                </label>
              ),
            )}
            {!bases.isPending && !bases.data?.length && (
              <p className="text-sm">No knowledge bases yet.</p>
            )}
            <label className="block text-sm">
              Compatibility flow
              <select
                className={select}
                value={c.defaultFlowId ?? ""}
                onChange={(e) =>
                  edit({ ...c, defaultFlowId: e.target.value || null })
                }
              >
                <option value="">No default flow</option>
                {(flows.data ?? []).map((f: { id: string; name: string }) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            {flows.error && <p role="alert">{flows.error.message}</p>}
          </fieldset>
          <Link
            href="/knowledge-base"
            className="text-sm text-teal-700 underline"
          >
            Manage documents
          </Link>
        </section>
        <section id="property-behavior" className={panel}>
          <h2 className="font-semibold">Property Behavior</h2>
          <p className="rounded-xl border bg-muted/30 p-3 text-sm">
            Always verified inventory. Exact references keep priority.
            Availability and tenant ownership checks cannot be disabled.
          </p>
          <fieldset disabled={disabled} className="space-y-4">
            <div className={grid}>
              {(
                [
                  "directInventory",
                  "indirectInventory",
                  "fuzzyMatching",
                  "excludePreviouslyShown",
                ] as const
              ).map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={policy[key]}
                    onChange={(e) =>
                      edit({
                        ...c,
                        propertyPolicy: { ...policy, [key]: e.target.checked },
                      })
                    }
                  />
                  {key.replace(/([A-Z])/g, " $1")}
                </label>
              ))}
            </div>
            {selectField(
              "Distress deals",
              policy.distressDeals,
              ["include", "exclude", "only"],
              (s) =>
                edit({
                  ...c,
                  propertyPolicy: {
                    ...policy,
                    distressDeals: s as typeof policy.distressDeals,
                  },
                }),
            )}
            <div className={grid}>
              {(
                [
                  ["maxResults", "Maximum results", 1, 20, 1],
                  ["minimumMatchScore", "Minimum match score", 0.7, 1, 0.01],
                  ["priceRelaxationPercent", "Price relaxation (%)", 0, 10, 1],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <label key={key} className="text-sm">
                  {label}
                  <Input
                    className="mt-2"
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={policy[key]}
                    onChange={(e) =>
                      edit({
                        ...c,
                        propertyPolicy: {
                          ...policy,
                          [key]: Number(e.target.value),
                        },
                      })
                    }
                  />
                </label>
              ))}
            </div>
            {selectField(
              "Clarification rules",
              policy.clarificationRules,
              ["location-required", "any-constraint"],
              (s) =>
                edit({
                  ...c,
                  propertyPolicy: {
                    ...policy,
                    clarificationRules: s as typeof policy.clarificationRules,
                  },
                }),
            )}
            <label className="block text-sm">
              Approved area alternatives (one per line)
              <Textarea
                dir="auto"
                className="mt-2"
                value={policy.areaAlternatives.join("\n")}
                onChange={(e) =>
                  edit({
                    ...c,
                    propertyPolicy: {
                      ...policy,
                      areaAlternatives: e.target.value
                        .split("\n")
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
          </fieldset>
        </section>
        <section id="tools" className={panel}>
          <h2 className="font-semibold">Tools</h2>
          <p className="text-sm text-muted-foreground">
            Only platform-approved capabilities. Permissions do not execute
            actions. Existing automated runtime paths enforce their gates;
            unconnected capabilities remain simulated in tests.
          </p>
          <fieldset
            disabled={disabled}
            className="grid min-w-0 gap-2 sm:grid-cols-2"
          >
            {studioTools.map((tool) => (
              <label
                key={tool}
                className="flex min-w-0 gap-2 rounded-lg border p-3 text-sm"
              >
                <input
                  type="checkbox"
                  checked={c.tools.includes(tool)}
                  onChange={(e) =>
                    edit({
                      ...c,
                      tools: e.target.checked
                        ? [...c.tools, tool]
                        : c.tools.filter((t) => t !== tool),
                    })
                  }
                />
                <bdi dir="ltr" className="break-all">
                  {tool}
                </bdi>
              </label>
            ))}
          </fieldset>
        </section>
        <section id="human-handoff" className={panel}>
          <h2 className="font-semibold">Human Handoff</h2>
          <p className="text-sm text-muted-foreground">
            A customer's explicit human request and accepted human ownership
            always take precedence.
          </p>
          <fieldset disabled={disabled} className="space-y-4">
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={handoff.automatic}
                onChange={(e) =>
                  edit({
                    ...c,
                    handoffPolicy: { ...handoff, automatic: e.target.checked },
                  })
                }
              />
              Automatic escalation
            </label>
            <label className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={handoff.onNoMatch}
                onChange={(e) =>
                  edit({
                    ...c,
                    handoffPolicy: { ...handoff, onNoMatch: e.target.checked },
                  })
                }
              />
              Escalate after no verified property match
            </label>
            <label className="block text-sm">
              Preferred team member
              <select
                className={select}
                value={handoff.defaultMemberId ?? ""}
                onChange={(e) =>
                  edit({
                    ...c,
                    handoffPolicy: {
                      ...handoff,
                      defaultMemberId: e.target.value || null,
                    },
                  })
                }
              >
                <option value="">Use workspace routing</option>
                {(team.data ?? [])
                  .filter((m: { active: boolean }) => m.active)
                  .map((m: { id: string; name: string }) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
              </select>
            </label>
            {team.error && <p role="alert">{team.error.message}</p>}
          </fieldset>
          <Link
            href="/settings/handoff"
            className="text-sm text-teal-700 underline"
          >
            Manage team routing and handoffs
          </Link>
        </section>
        <section id="model" className={panel}>
          <h2 className="font-semibold">Model preferences</h2>
          <p className="text-sm text-muted-foreground">
            Provider, temperature and output limits are above. Platform
            credentials remain private.
          </p>
          <fieldset disabled={disabled} className="space-y-4">
            {selectField(
              "Model",
              c.modelPolicy.model ?? "automatic",
              [
                "automatic",
                "claude-sonnet-4-20250514",
                "openai/gpt-oss-120b",
                "openai/gpt-oss-20b",
                "llama-3.3-70b-versatile",
              ],
              (s) =>
                edit({
                  ...c,
                  modelPolicy: {
                    ...c.modelPolicy,
                    model: s as AgentConfig["modelPolicy"]["model"],
                  },
                }),
            )}
            <div className={grid}>
              {(
                [
                  "qualityPreference",
                  "latencyPreference",
                  "costPreference",
                  "fallbackPolicy",
                ] as const
              ).map((key) => (
                <div key={key}>
                  {selectField(
                    key.replace(/([A-Z])/g, " $1"),
                    c.modelPolicy[key] ?? "balanced",
                    key === "qualityPreference"
                      ? ["balanced", "high"]
                      : key === "latencyPreference"
                        ? ["balanced", "fast"]
                        : key === "costPreference"
                          ? ["balanced", "economy"]
                          : ["provider-chain", "safe-response"],
                    (s) =>
                      edit({
                        ...c,
                        modelPolicy: { ...c.modelPolicy, [key]: s },
                      }),
                  )}
                </div>
              ))}
            </div>
          </fieldset>
        </section>
      </div>
      <PlaygroundPanel id={id} revision={revision} canEdit={!disabled} />
      <section id="activity" className={panel}>
        <h2 className="font-semibold">Activity</h2>
        <p className="text-sm text-muted-foreground">
          Configuration operations and draft test history for this assistant.
        </p>
        {activity.isPending && <p role="status">Loading activity…</p>}
        {activity.error && <p role="alert">{activity.error.message}</p>}
        {!activity.data?.length && !activity.isPending && (
          <p className="text-sm">No configuration activity yet.</p>
        )}
        <ol className="max-h-80 space-y-2 overflow-auto">
          {activity.data?.map((e) => (
            <li key={e.id} className="rounded-lg border p-3 text-sm">
              {e.action} · {new Date(e.created_at).toLocaleString()}
              <details className="mt-2">
                <summary className="cursor-pointer text-xs">
                  Operation details
                </summary>
                <pre
                  dir="ltr"
                  className="mt-2 whitespace-pre-wrap break-all text-xs"
                >
                  {JSON.stringify(e.details, null, 2)}
                </pre>
              </details>
            </li>
          ))}
        </ol>
        <Link
          href={"/ai-studio/" + id + "/traces"}
          className="text-sm text-teal-700 underline"
        >
          Open draft test traces
        </Link>
      </section>
    </>
  );
}
