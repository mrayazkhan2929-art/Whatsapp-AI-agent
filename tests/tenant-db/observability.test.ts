import { MessageRouter } from "../../backend/src/whatsapp/MessageRouter";
import { executionTrace } from "../../backend/src/modules/observability/ExecutionTraceService";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  chromium,
  expect as browserExpect,
  type Browser,
} from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Server } from "node:http";
import { createApiApp } from "../../backend/src/api/app";
import {
  defaultAgentConfig,
  type AgentConfig,
} from "../../backend/src/modules/config/AgentVersionService";
import { upgradeStudioConfig } from "../../frontend/src/lib/agent-studio";
import { generateReply } from "../../backend/src/modules/ai/aiService";
import pg from "pg";

const transport = vi.hoisted(() => ({
  send: vi.fn(async (_input: { text: string }) => ({
    deviceId: (_input as any).deviceId,
    messageId: (_input as any).messageId ?? "local-stub",
  })),
  provider: vi.fn(async (input: { system: string }) => ({
    usage: { input_tokens: 100, output_tokens: 20 },
    content: [
      {
        type: "text",
        text:
          "Verified configuration reply: " +
          (input.system.match(/RELEASE_[A-Z0-9_]+/)?.[0] ?? "NO_MARKER"),
      },
    ],
  })),
}));
vi.mock("../../backend/src/whatsapp/WhatsAppGateway", () => ({
  whatsAppGateway: {
    sendText: transport.send,
    getConnectedDeviceIds: () => [],
    getRuntimeSnapshotSummary: () => ({}),
    getRuntimeSnapshot: () => null,
    normalizeDeviceStatus: (status: string) => status,
    getTransportHealth: () => null,
  },
}));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: transport.provider };
  },
}));
vi.mock("../../backend/src/rag/EmbeddingService", () => ({
  EmbeddingService: {
    embed: async () => {
      throw Error("Lexical evaluation fixture");
    },
    valid: (v: number[]) => Array.isArray(v) && v.length === 1536,
  },
}));
vi.mock("groq-sdk", () => ({
  default: class {
    chat = {
      completions: {
        create: vi.fn(() => {
          throw new Error("Unexpected Groq call");
        }),
      },
    };
  },
}));
// Exercise authentication and tenant checks at full speed without testing the time-window limiter here.
vi.mock("../../backend/src/api/middleware/rateLimit", () => ({
  apiRateLimit: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
const stack = JSON.parse(readFileSync(process.env.PHASE1_TEST_CONFIG!, "utf8"));
const admin = createClient(stack.url, stack.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const a = randomUUID(),
  b = randomUUID(),
  device = randomUUID(),
  bDevice = randomUUID(),
  unusedDevice = randomUUID(),
  aKb = randomUUID(),
  bKb = randomUUID(),
  bFlow = randomUUID();
const tables = [
  "execution_traces",
  "audit_logs",
  "conversation_states",
  "organizations",
  "users",
  "agents",
  "agent_versions",
  "agent_drafts",
  "agent_config_events",
  "agent_version_tools",
  "agent_version_knowledge_bases",
  "agent_channel_links",
  "devices",
  "knowledge_bases",
  "flows",
  "contacts",
  "conversations",
  "messages",
  "properties",
  "inventory_gaps",
  "knowledge_chunks",
  "knowledge_documents",
  "knowledge_document_versions",
  "knowledge_document_chunks",
  "agent_playground_runs",
  "team_members",
  "bookings",
];
const output = resolve(
  process.env.PHASE_OBSERVABILITY_REPORT_DIR ?? "docs/phase9/artifacts",
);
let server: Server,
  next: ChildProcess,
  browser: Browser,
  backendUrl: string,
  frontendUrl: string;
let token: string,
  bToken: string,
  viewerToken: string,
  actor: string,
  bAgent: string,
  bVersion: string;
let beforeB: unknown,
  requests = 0,
  bChecks = 0,
  externalRequests = 0;
const logs: string[] = [];
const browserErrors: string[] = [];
async function insert(table: string, rows: unknown) {
  const result = await admin.from(table).insert(rows as any);
  if (result.error) throw result.error;
}
async function identity(label: string, orgId: string, role = "admin") {
  const email = label + "@phase9.example.invalid",
    password = "Phase3-local-fixture-123!";
  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { org_id: b, role: "owner" },
  });
  if (created.error) throw created.error;
  await insert("users", {
    id: created.data.user.id,
    org_id: orgId,
    email,
    name: label,
    role,
    active: true,
    password_hash: "local-fixture",
  });
  const client = createClient(stack.url, stack.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signed = await client.auth.signInWithPassword({ email, password });
  if (signed.error) throw signed.error;
  return { token: signed.data.session!.access_token, id: created.data.user.id };
}
async function call(
  surface: "backend" | "frontend",
  path: string,
  method = "GET",
  body?: unknown,
  credential = token,
) {
  requests++;
  const response = await fetch(
    (surface === "backend" ? backendUrl + "/api/v1" : frontendUrl + "/api") +
      path,
    {
      method,
      headers: {
        authorization: "Bearer " + credential,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
  );
  return { status: response.status, body: await response.json() };
}
async function create(
  name = "Release assistant",
  credential = token,
  surface: "backend" | "frontend" = "backend",
) {
  const config = defaultAgentConfig(name, "Use RELEASE_ONE and a calm tone.");
  const result = await call(
    surface,
    "/agents",
    "POST",
    { name, config, org_id: b, orgId: b },
    credential,
  );
  expect(result.status, JSON.stringify(result.body)).toBe(201);
  return { id: result.body.data.id as string, config };
}
async function state(id: string, credential = token) {
  const agent = await call(
    "backend",
    "/agents/" + id,
    "GET",
    undefined,
    credential,
  );
  const draft = await call(
    "backend",
    "/agents/" + id + "/draft",
    "GET",
    undefined,
    credential,
  );
  expect(agent.status).toBe(200);
  expect(draft.status).toBe(200);
  return {
    expectedRevision: draft.body.data.revision as number,
    expectedPublishedVersionId: agent.body.data.published_version_id as
      | string
      | null,
  };
}
async function publish(
  id: string,
  credential = token,
  surface: "backend" | "frontend" = "backend",
) {
  const revision = await state(id, credential);
  expect(
    (
      await call(
        surface,
        "/agents/" + id + "/test",
        "POST",
        revision,
        credential,
      )
    ).status,
  ).toBe(200);
  const result = await call(
    surface,
    "/agents/" + id + "/publish",
    "POST",
    revision,
    credential,
  );
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return result.body.data.version as {
    id: string;
    version_number: number;
    config: AgentConfig;
  };
}
async function snapshotB() {
  const snapshot: Record<string, unknown> = {};
  for (const table of tables) {
    const result = await admin
      .from(table)
      .select("*")
      .eq(table === "organizations" ? "id" : "org_id", b);
    if (result.error) throw result.error;
    // REST does not promise row ordering. Compare every full row in stable order.
    snapshot[table] = result.data?.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right)),
    );
  }
  return snapshot;
}
let aAgent: string, aVersion: string, bTrace: string, bMessage: string;
const aMember = randomUUID(),
  aProperty = randomUUID(),
  bProperty = randomUUID(),
  evaluations: Array<Record<string, unknown>> = [];
beforeAll(async () => {
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      if (!["127.0.0.1", "localhost"].includes(url.hostname)) {
        externalRequests++;
        throw Error("External request blocked");
      }
      return nativeFetch(input, init);
    },
  );
  mkdirSync(output, { recursive: true });
  process.env.ANTHROPIC_API_KEY = "phase9-local-stub";
  process.env.AI_COST_RATES_JSON =
    '{"claude-sonnet-4-20250514":{"inputPerMillion":2,"outputPerMillion":4}}';
  await insert("organizations", [
    { id: a, name: "Evidence A", slug: "phase9-a" },
    { id: b, name: "Private Evidence B", slug: "phase9-b" },
  ]);
  const identities = await Promise.all([
    identity("operator-a", a),
    identity("operator-b", b),
    identity("viewer-a", a, "viewer"),
  ]);
  token = identities[0].token;
  actor = identities[0].id;
  bToken = identities[1].token;
  viewerToken = identities[2].token;
  await insert("devices", [
    { id: device, org_id: a, name: "Evidence A channel" },
    { id: bDevice, org_id: b, name: "Private B channel" },
  ]);
  await insert("knowledge_bases", [
    { id: aKb, org_id: a, name: "A guides" },
    { id: bKb, org_id: b, name: "Private B guides" },
  ]);
  await insert("knowledge_chunks", [
    {
      org_id: a,
      knowledge_base_id: aKb,
      content:
        "The lighthousepolicy permits scheduled viewings using verified details.",
      metadata: {},
    },
    {
      org_id: b,
      knowledge_base_id: bKb,
      content: "Private B only knowledge.",
      metadata: {},
    },
  ]);
  await insert("properties", [
    ...Array.from({ length: 4 }, (_, i) => ({
      id: i === 0 ? aProperty : randomUUID(),
      org_id: a,
      ref: "EVAL-A" + (i + 1),
      ref_number: "EVAL-A" + (i + 1),
      type: "apartment",
      category: "sale",
      transaction_type: "SALE",
      district: "Dubai Marina",
      bedrooms: "2",
      price_aed: 1200000 + i * 100000,
      status: "ready",
      source: "direct",
      available: true,
      distress_deal: false,
    })),
    {
      id: bProperty,
      org_id: b,
      ref: "PRIVATE-B",
      ref_number: "PRIVATE-B",
      type: "villa",
      district: "Dubai Marina",
      price_aed: 9000000,
      source: "direct",
      available: true,
      distress_deal: false,
    },
  ]);
  await insert("team_members", {
    id: aMember,
    org_id: a,
    name: "Verified A member",
    role: "Agent",
    whatsapp: "971500008888",
    email: "member-a@phase9.example.invalid",
    active: true,
  });
  server = await new Promise<Server>((done) => {
    const listener = createApiApp(0).listen(0, "127.0.0.1", () =>
      done(listener),
    );
  });
  backendUrl =
    "http://127.0.0.1:" + (server.address() as { port: number }).port;
  next = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "start",
      "-p",
      "0",
      "-H",
      "127.0.0.1",
    ],
    {
      cwd: resolve("frontend"),
      env: { ...process.env, NODE_ENV: "production", BACKEND_URL: backendUrl },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  await new Promise<void>((done, reject) => {
    const timeout = setTimeout(
      () => reject(Error("Next startup timed out")),
      60000,
    );
    const read = (chunk: Buffer) => {
      const text = chunk.toString();
      logs.push(text);
      const match = text.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) frontendUrl = match[0];
      if (/Ready in/.test(text)) {
        clearTimeout(timeout);
        done();
      }
    };
    next.stdout!.on("data", read);
    next.stderr!.on("data", read);
    next.on("exit", (code) => {
      clearTimeout(timeout);
      reject(Error("Next exit " + code));
    });
  });
  const created = await create("Evidence assistant");
  aAgent = created.id;
  const config = {
    ...upgradeStudioConfig(created.config),
    knowledgeBaseIds: [aKb],
    tools: [
      "property.lookup",
      "property.search",
      "property.compare",
      "property.send_media",
      "knowledge.search",
      "team.lookup",
      "handoff.create",
    ],
  };
  expect(
    (
      await call("backend", "/agents/" + aAgent + "/draft", "PATCH", {
        ...(await state(aAgent)),
        config,
      })
    ).status,
  ).toBe(200);
  aVersion = (await publish(aAgent)).id;
  expect(
    (
      await call("backend", "/agents/" + aAgent + "/channels", "POST", {
        deviceId: device,
      })
    ).status,
  ).toBe(200);
  const createdB = await create("Private B assistant", bToken);
  bAgent = createdB.id;
  bVersion = (await publish(bAgent, bToken)).id;
  const bc = randomUUID(),
    bv = randomUUID();
  bTrace = randomUUID();
  bMessage = randomUUID();
  await insert("contacts", {
    id: bc,
    org_id: b,
    phone: "+9000000000",
    name: "Private B contact",
  });
  await insert("conversations", {
    id: bv,
    org_id: b,
    contact_id: bc,
    device_id: bDevice,
  });
  await insert("messages", {
    id: bMessage,
    org_id: b,
    conversation_id: bv,
    direction: "outbound",
    sender_type: "ai",
    content: "Private B reply",
    metadata: { executionTraceId: bTrace },
  });
  await insert("execution_traces", {
    id: bTrace,
    org_id: b,
    source: "http",
    conversation_id: bv,
    outbound_message_id: bMessage,
    status: "completed",
    evidence: { intent: "Private B sentinel", propertyIds: [bProperty] },
  });
  browser = await chromium.launch({ headless: true });
  await new Promise((r) => setTimeout(r, 100));
});
beforeEach(async () => {
  beforeB = await snapshotB();
  transport.provider.mockClear();
  transport.send.mockClear();
});
afterEach(async () => {
  expect(await snapshotB()).toEqual(beforeB);
  expect(externalRequests).toBe(0);
  bChecks++;
});
afterAll(async () => {
  await browser?.close();
  next?.kill();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
  writeFileSync(
    resolve(stack.directory, "observability-http-evidence.json"),
    JSON.stringify(
      {
        requests,
        tenantBSnapshotChecks: bChecks,
        snapshotTables: tables,
        externalRequests,
        browserErrors,
        evaluationCases: evaluations,
        providerAndGateway: "stubbed; local Auth/REST/HTTP/browser real",
        appliedToLiveProject: false,
      },
      null,
      2,
    ),
  );
  writeFileSync(resolve(output, "frontend.log"), logs.join(""));
});
async function traceRow(id: string) {
  for (let i = 0; i < 60; i++) {
    const r = await admin
      .from("execution_traces")
      .select("*")
      .eq("org_id", a)
      .eq("id", id)
      .maybeSingle();
    if (r.error) throw r.error;
    if (r.data) return r.data;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("Trace not retained: " + id);
}
async function conversation() {
  const contact = randomUUID(),
    id = randomUUID();
  await insert("contacts", {
    id: contact,
    org_id: a,
    phone: "9715" + Date.now() + Math.floor(Math.random() * 1000),
    name: "Local evaluation contact",
  });
  await insert("conversations", {
    id,
    org_id: a,
    contact_id: contact,
    device_id: device,
  });
  return { id, contact };
}
async function chat(
  message: string,
  surface: "backend" | "frontend" = "backend",
  conversationId?: string,
) {
  const result = await call(surface, "/chat", "POST", {
    message,
    deviceId: device,
    conversationId,
    phoneNumber: "+971501234567",
    org_id: b,
  });
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  return { result, trace: await traceRow(result.body.executionTraceId) };
}
for (const surface of ["backend", "frontend"] as const)
  describe(surface + " evidence boundary", () => {
    it("denies viewer trace, audit and message explanation access", async () => {
      for (const path of [
        "/observability/traces",
        "/observability/audit",
        "/observability/traces/" + bTrace,
        "/observability/messages/" + bMessage,
      ])
        expect(
          (await call(surface, path, "GET", undefined, viewerToken)).status,
        ).toBe(403);
    });
    it("foreign trace is 404", async () =>
      expect(
        (await call(surface, "/observability/traces/" + bTrace)).status,
      ).toBe(404));
    it("foreign AI message explanation is 404", async () =>
      expect(
        (await call(surface, "/observability/messages/" + bMessage)).status,
      ).toBe(404));
    it("ignores forged organization filters and never returns B evidence", async () => {
      const r = await call(
        surface,
        "/observability/traces?org_id=" + b + "&orgId=" + b,
      );
      expect(r.status).toBe(200);
      expect(
        r.body.data.every(
          (row: any) => row.org_id === undefined || row.org_id === a,
        ),
      ).toBe(true);
      expect(JSON.stringify(r.body)).not.toContain("Private B");
    });
    it("foreign related filters are 404", async () => {
      for (const filter of [
        "agentId=" + bAgent,
        "deviceId=" + bDevice,
        "conversationId=" + randomUUID(),
      ])
        expect(
          (await call(surface, "/observability/traces?" + filter)).status,
        ).toBe(404);
    });
    it("malformed cursor and bounds fail visibly", async () => {
      for (const q of [
        "limit=101",
        "limit=0",
        "cursor=invalid",
        "status=invalid",
      ])
        expect((await call(surface, "/observability/traces?" + q)).status).toBe(
          400,
        );
    });
    it("real chat writes complete owned evidence and no raw user secrets", async () => {
      const { trace } = await chat(
        "What does the process involve? sk-sensitive-private operator@example.invalid",
        surface,
      );
      expect(trace).toMatchObject({
        org_id: a,
        agent_id: aAgent,
        agent_version_id: aVersion,
        source: "http",
        status: "completed",
      });
      expect(trace.evidence.providerAttempts.length).toBeGreaterThan(0);
      expect(trace.evidence.tokens).toEqual({ input: 100, output: 20 });
      expect(trace.evidence.estimatedCostUSD).toBeCloseTo(0.00028);
      expect(trace.evidence.providerAttempts[0].costBasis).toMatchObject({
        currency: "USD",
        inputPerMillion: 2,
        outputPerMillion: 4,
      });
      expect(JSON.stringify(trace)).not.toMatch(
        /sensitive-private|operator@example|971501234567/,
      );
      expect(
        trace.evidence.validationGates.some(
          (g: any) => g.name === "no_platform_secret",
        ),
      ).toBe(true);
    });
    it("mutation audit records actor and changed fields without values", async () => {
      const created = await create("Private naming value", token, surface);
      for (let i = 0; i < 30; i++) {
        const r = await call(surface, "/observability/audit");
        expect(r.status).toBe(200);
        if (
          r.body.data.some(
            (row: any) =>
              row.action === "post.agents" && row.actor_id === actor,
          )
        ) {
          expect(JSON.stringify(r.body.data)).not.toContain(
            "Private naming value",
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      throw Error("Mutation audit missing");
    });
  });
it("SQL rejects foreign parents and nested property evidence", async () => {
  for (const input of [
    { device_id: bDevice },
    { agent_id: bAgent },
    { agent_version_id: bVersion },
    { evidence: { propertyIds: [bProperty] } },
  ]) {
    const result = await admin
      .from("execution_traces")
      .insert({
        id: randomUUID(),
        org_id: a,
        source: "helper",
        status: "completed",
        evidence: {},
        ...input,
      });
    expect(result.error).not.toBeNull();
  }
});
it("SQL rejects mismatched knowledge provenance parents", async () => {
  expect(
    (
      await admin
        .from("execution_traces")
        .insert({
          id: randomUUID(),
          org_id: a,
          source: "helper",
          status: "completed",
          evidence: {
            knowledgeSources: [
              {
                knowledgeBaseId: bKb,
                chunkId: randomUUID(),
                documentId: randomUUID(),
                versionId: randomUUID(),
              },
            ],
          },
        })
    ).error,
  ).not.toBeNull();
});
it("trace and audit records are immutable even through service REST", async () => {
  const { trace } = await chat("Hello");
  const database = new pg.Client({ connectionString: stack.dbUrl });
  await database.connect();
  try {
    const privileges = await database.query(`
      SELECT tablename,
        has_table_privilege('service_role', 'public.' || tablename, 'SELECT') AS can_read,
        has_table_privilege('service_role', 'public.' || tablename, 'INSERT') AS can_insert,
        has_table_privilege('service_role', 'public.' || tablename, 'UPDATE') AS can_update,
        has_table_privilege('service_role', 'public.' || tablename, 'DELETE') AS can_delete,
        has_table_privilege('service_role', 'public.' || tablename, 'TRUNCATE') AS can_truncate
      FROM pg_tables WHERE schemaname = 'public'
        AND tablename IN ('execution_traces', 'audit_logs') ORDER BY tablename
    `);
    expect(privileges.rows).toEqual(
      ["audit_logs", "execution_traces"].map((tablename) => ({
        tablename, can_read: true, can_insert: true,
        can_update: false, can_delete: false, can_truncate: false,
      })),
    );
  } finally {
    await database.end();
  }
  for (const table of ["execution_traces", "audit_logs"]) {
    expect(
      (await admin.from(table).update({ org_id: b }).eq("org_id", a)).error,
    ).not.toBeNull();
    expect(
      (await admin.from(table).delete().eq("org_id", a)).error,
    ).not.toBeNull();
  }
});
it("audit rows require an actor from the same active tenant", async () => {
  expect(
    (
      await admin
        .from("audit_logs")
        .insert({
          org_id: b,
          actor_id: actor,
          action: "invalid",
          resource_type: "test",
          outcome: "succeeded",
          details: {},
        })
    ).error,
  ).not.toBeNull();
});
it("anonymous and authenticated REST cannot read or write private evidence", async () => {
  for (const credential of [stack.anonKey, token]) {
    const client = createClient(stack.url, stack.anonKey, {
      global: { headers: { Authorization: "Bearer " + credential } },
      auth: { persistSession: false },
    });
    for (const table of ["execution_traces", "audit_logs"]) {
      expect((await client.from(table).select("*")).error).not.toBeNull();
      expect(
        (await client.from(table).insert({ org_id: b })).error,
      ).not.toBeNull();
    }
  }
});
it("concurrent actual turns retain independent tenant context", async () => {
  await Promise.all([
    executionTrace.run({ orgId: a, source: "helper" }, async () => {
      executionTrace.patch({ intent: "Concurrent A" });
      await new Promise((r) => setTimeout(r, 20));
    }),
    executionTrace.run({ orgId: a, source: "helper" }, async () =>
      executionTrace.patch({ intent: "Concurrent A second" }),
    ),
  ]);
  const rows = await admin
    .from("execution_traces")
    .select("evidence")
    .eq("org_id", a);
  expect(
    rows.data?.filter((r) =>
      String(r.evidence.intent).startsWith("Concurrent A"),
    ),
  ).toHaveLength(2);
});
it("failed providers retain fallback attempts and safe error codes", async () => {
  transport.provider.mockRejectedValueOnce(
    Error("Bearer private-provider-error"),
  );
  const { trace } = await chat("What does the process involve?");
  expect(trace.evidence.fallback).toBe(true);
  expect(JSON.stringify(trace)).not.toContain("private-provider-error");
  expect(trace.evidence.providerAttempts[0].outcome).toBe("provider_failed");
});
it("saved message explanation requires matching owned trace context", async () => {
  const conv = await conversation(),
    { trace } = await chat("Show REF EVAL-A1", "backend", conv.id);
  const own = await admin
    .from("messages")
    .select("id")
    .eq("org_id", a)
    .eq("conversation_id", conv.id)
    .eq("direction", "outbound")
    .single();
  const r = await call("frontend", "/observability/messages/" + own.data!.id);
  expect(r.status).toBe(200);
  expect(r.body.data.id).toBe(trace.id);
  await admin
    .from("messages")
    .update({ metadata: { executionTraceId: bTrace } })
    .eq("id", own.data!.id)
    .eq("org_id", a);
  expect(
    (await call("backend", "/observability/messages/" + own.data!.id)).status,
  ).toBe(404);
});
it("history cursor is bounded, stable and does not duplicate records", async () => {
  await chat("Hello");
  await chat("Hello again");
  const first = await call("frontend", "/observability/traces?limit=2");
  expect(first.body.data).toHaveLength(2);
  expect(first.body.nextCursor).toBeTruthy();
  const second = await call(
    "frontend",
    "/observability/traces?limit=2&cursor=" +
      encodeURIComponent(first.body.nextCursor),
  );
  expect(second.status).toBe(200);
  expect(
    second.body.data.some((r: any) =>
      first.body.data.some((s: any) => s.id === r.id),
    ),
  ).toBe(false);
});
it("a human-active turn records a skipped explanation without generating or sending", async () => {
  const conv = await conversation();
  await admin
    .from("conversations")
    .update({ handled_by: "human", assigned_to: aMember })
    .eq("org_id", a)
    .eq("id", conv.id);
  const message = {
    key: { remoteJid: "+971599999999@s.whatsapp.net", id: randomUUID() },
    message: { conversation: "Hello" },
  };
  const customer = await admin
    .from("contacts")
    .select("phone")
    .eq("id", conv.contact)
    .single();
  message.key.remoteJid =
    customer.data!.phone.replace("+", "") + "@s.whatsapp.net";
  const router = new MessageRouter({ send: transport.send });
  await router.routeMessage(device, a, message as any);
  expect(transport.send).not.toHaveBeenCalled();
  expect(transport.provider).not.toHaveBeenCalled();
  const row = await admin
    .from("execution_traces")
    .select("*")
    .eq("org_id", a)
    .eq("conversation_id", conv.id)
    .single();
  expect(row.data).toMatchObject({
    status: "skipped",
    evidence: { failureReason: "HUMAN_HANDOFF" },
  });
});
it("unsupported media records a skipped turn without provider effects", async () => {
  await new MessageRouter({ send: transport.send }).routeMessage(device, a, {
    key: { id: randomUUID(), remoteJid: "971599999998@s.whatsapp.net" },
    message: { imageMessage: { caption: "Image only" } },
  } as any);
  expect(transport.provider).not.toHaveBeenCalled();
  const rows = await admin
    .from("execution_traces")
    .select("evidence,status")
    .eq("org_id", a);
  expect(
    rows.data?.some(
      (r) =>
        r.status === "skipped" &&
        r.evidence.failureReason === "UNSUPPORTED_MEDIA",
    ),
  ).toBe(true);
});
it("uncertain delivery records review_required without sending a second reply", async () => {
  const id = randomUUID(),
    msg = {
      key: { id, remoteJid: "971599999997@s.whatsapp.net" },
      message: { conversation: "Show REF EVAL-A1" },
    };
  const send = vi.fn(async () => {
    throw Error("Transport uncertainty");
  });
  const router = new MessageRouter({ send });
  await router.routeMessage(device, a, msg as any);
  await router.routeMessage(device, a, msg as any);
  expect(send).toHaveBeenCalledTimes(1);
  const rows = await admin.from("execution_traces").select("*").eq("org_id", a);
  expect(
    rows.data?.some(
      (r) =>
        r.status === "failed" && r.evidence.transport === "review_required",
    ),
  ).toBe(true);
});
const corpus = JSON.parse(
  readFileSync("tests/fixtures/ai-evaluation.json", "utf8"),
) as Array<{
  category: string;
  message: string;
  lanes: string[];
  ref?: string;
  area?: string;
  maxPrice?: number;
  bedrooms?: string;
  language?: string;
  handoff?: boolean;
  followUp?: boolean;
  noMatch?: boolean;
  knowledge?: boolean;
  duplicate?: boolean;
}>;
for (const fixture of corpus)
  it("evaluation corpus: " + fixture.category, async () => {
    if (fixture.duplicate) {
      const id = randomUUID(),
        msg = {
          key: { id, remoteJid: "971599999996@s.whatsapp.net" },
          message: { conversation: fixture.message },
        },
        router = new MessageRouter({ send: transport.send });
      await Promise.all([
        router.routeMessage(device, a, msg as any),
        router.routeMessage(device, a, msg as any),
      ]);
      expect(transport.send).toHaveBeenCalledTimes(1);
      const m = await admin
        .from("messages")
        .select("*")
        .eq("org_id", a)
        .eq("wa_message_id", id)
        .eq("direction", "inbound")
        .single();
      const t = await admin
        .from("execution_traces")
        .select("*")
        .eq("org_id", a)
        .eq("inbound_message_id", m.data!.id);
      expect(t.data).toHaveLength(2);
      expect(t.data?.filter((r) => r.status === "skipped")).toHaveLength(1);
      evaluations.push({
        category: fixture.category,
        passed: true,
        traceIds: t.data?.map((r) => r.id),
      });
      return;
    }
    const conv = await conversation();
    if (fixture.followUp) await chat("Show REF EVAL-A1", "backend", conv.id);
    const { result, trace } = await chat(fixture.message, "backend", conv.id);
    expect(fixture.lanes).toContain(result.body.lane);
    expect(trace.evidence.intent).toBe(result.body.lane);
    expect(trace.agent_version_id ?? aVersion).toBe(aVersion);
    if (fixture.language) {
      expect(result.body.language).toBe(fixture.language);
      expect(result.body.reply).toMatch(/[\u0600-\u06ff]/);
    }
    if (fixture.handoff) expect(result.body.handoff).toBe(true);
    if (fixture.noMatch) expect(result.body.matchedProperties).toBe(0);
    if (fixture.ref) {
      expect(trace.evidence.propertyQuery.referenceNumber.toUpperCase()).toBe(
        fixture.ref,
      );
      expect(trace.evidence.propertyIds).toContain(aProperty);
    }
    if (fixture.area)
      expect(trace.evidence.propertyQuery.area).toBe(fixture.area);
    if (fixture.bedrooms)
      expect(trace.evidence.propertyQuery.bedrooms).toBe(fixture.bedrooms);
    if (fixture.maxPrice)
      expect(trace.evidence.propertyQuery.maxPrice).toBe(fixture.maxPrice);
    if (fixture.knowledge) {
      expect(trace.evidence.knowledgeSources.length).toBeGreaterThan(0);
      expect(
        trace.evidence.toolCalls.some(
          (t: any) => t.name === "knowledge.search" && t.parameters.querySHA256,
        ),
      ).toBe(true);
      expect(
        trace.evidence.knowledgeSources.every(
          (s: any) => s.knowledgeBaseId === aKb,
        ),
      ).toBe(true);
    }
    expect(JSON.stringify(trace)).not.toContain("Private B");
    expect(result.body.reply).not.toMatch(
      /sk-|Bearer|appointment is confirmed|I booked/i,
    );
    evaluations.push({
      category: fixture.category,
      passed: true,
      traceId: trace.id,
      lane: result.body.lane,
      language: result.body.language,
    });
  });
for (const viewport of [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "rtl", width: 1100, height: 900 },
])
  it("execution evidence browser " + viewport.name, async () => {
    const { trace } = await chat("Show REF EVAL-A1"),
      context = await browser.newContext({ viewport });
    await context.addCookies([
      { name: "sb-access-token", value: token, url: frontendUrl },
    ]);
    const page = await context.newPage();
    page.on("pageerror", (e) => browserErrors.push(e.message));
    await page.goto(frontendUrl + "/execution-traces/" + trace.id);
    await browserExpect(
      page.getByRole("heading", { name: "Why this reply?", exact: true }),
    ).toBeVisible();
    await browserExpect(
      page.getByText("Property query", { exact: true }),
    ).toBeVisible();
    await browserExpect(
      page.getByText("EVAL-A1", { exact: false }).first(),
    ).toBeVisible();
    if (viewport.name === "rtl")
      await page
        .locator("main")
        .last()
        .evaluate((el) => el.setAttribute("dir", "rtl"));
    await page.screenshot({
      path: resolve(output, "execution-" + viewport.name + ".png"),
      fullPage: true,
    });
    await page.screenshot({
      path: resolve(output, "execution-viewport-" + viewport.name + ".png"),
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.getByRole("link", { name: "Back to execution history" }).click();
    await browserExpect(
      page.getByRole("heading", { name: "Why this reply?", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View action audit" }).click();
    await browserExpect(
      page.getByRole("heading", { name: "Action audit", exact: true }),
    ).toBeVisible();
    expect(browserErrors).toEqual([]);
    await context.close();
  });
it("viewer browser blocks evidence and hides the privileged Inbox link", async () => {
  const conv = await conversation();
  await admin
    .from("contacts")
    .update({ name: "Viewer inspection contact" })
    .eq("org_id", a)
    .eq("id", conv.contact);
  await chat("Show REF EVAL-A1", "backend", conv.id);
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sb-access-token", value: viewerToken, url: frontendUrl },
  ]);
  const page = await context.newPage();
  await page.goto(frontendUrl + "/inbox");
  await page
    .getByText("Viewer inspection contact", { exact: true })
    .first()
    .click();
  await browserExpect(
    page.getByText("Verified listing", { exact: false }).first(),
  ).toBeVisible();
  await browserExpect(
    page.getByRole("link", { name: "Why this reply?", exact: true }),
  ).toHaveCount(0);
  await page.goto(frontendUrl + "/execution-traces/" + bTrace);
  await browserExpect(page.locator("p[role=alert]")).toContainText(
    "Only owners",
  );
  expect(await page.locator("body").innerText()).not.toContain("Private B");
  await context.close();
});
it("privileged Inbox provides a keyboard reachable Why this reply link", async () => {
  const conv = await conversation();
  await admin
    .from("contacts")
    .update({ name: "Inbox explanation contact" })
    .eq("org_id", a)
    .eq("id", conv.contact);
  await chat("Show REF EVAL-A1", "backend", conv.id);
  const context = await browser.newContext();
  await context.addCookies([
    { name: "sb-access-token", value: token, url: frontendUrl },
  ]);
  const page = await context.newPage();
  await page.goto(frontendUrl + "/inbox");
  await page
    .getByText("Inbox explanation contact", { exact: true })
    .first()
    .click();
  const link = page
    .getByRole("link", { name: "Why this reply?", exact: true })
    .last();
  await browserExpect(link).toBeVisible();
  await link.focus();
  await page.keyboard.press("Enter");
  await browserExpect(
    page.getByRole("heading", { name: "Why this reply?", exact: true }),
  ).toBeVisible();
  await context.close();
});
