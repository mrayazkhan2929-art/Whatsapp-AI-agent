import { Router, type Response } from "express";
import { z } from "zod";
import { getSupabaseAdmin } from "../../config/supabase.js";
import {
  ConfigError,
  databaseError,
} from "../../modules/config/AgentVersionService.js";
import { recordAudit } from "../../modules/observability/AuditLogService.js";
import { sendApiError } from "../http.js";
import { checkTenantReferences } from "../tenant.js";
import type { AuthenticatedRequest } from "../types.js";
const router = Router();
const cursorSchema = z
  .object({
    time: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  })
  .strict();
const filtersSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().max(300).optional(),
  agentId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  status: z.enum(["completed", "failed", "skipped"]).optional(),
});
function privileged(
  fn: (req: AuthenticatedRequest, res: Response) => Promise<void>,
) {
  return async (req: AuthenticatedRequest, res: Response) => {
    try {
      if (
        !req.auth ||
        !req.orgId ||
        !["owner", "admin"].includes(req.auth.role)
      ) {
        if (req.auth && req.orgId)
          await recordAudit(
            req.auth,
            "evidence.denied",
            "execution_traces",
            null,
            { method: "GET" },
            403,
          );
        throw new ConfigError(
          403,
          "FORBIDDEN",
          "Only owners and administrators can inspect execution evidence",
        );
      }
      await fn(req, res);
    } catch (error) {
      if (error instanceof z.ZodError) {
        sendApiError(res, 400, "VALIDATION_FAILED", "Invalid evidence query");
        return;
      }
      if (error instanceof ConfigError) {
        sendApiError(res, error.status, error.code, error.message);
        return;
      }
      sendApiError(
        res,
        500,
        "EVIDENCE_LOOKUP_FAILED",
        "Execution evidence is unavailable",
      );
    }
  };
}
async function access(
  req: AuthenticatedRequest,
  action: string,
  id: string | null,
) {
  if (
    !(await recordAudit(
      req.auth!,
      action,
      action.startsWith("audit.") ? "audit_logs" : "execution_traces",
      id,
      { method: "GET" },
    ))
  )
    throw new ConfigError(
      503,
      "AUDIT_UNAVAILABLE",
      "Evidence access auditing is unavailable",
    );
}
async function ownedTrace(org: string, id: string) {
  const r = await getSupabaseAdmin()
    .from("execution_traces")
    .select("*")
    .eq("org_id", org)
    .eq("id", id)
    .maybeSingle();
  if (r.error) databaseError(r.error);
  if (!r.data)
    throw new ConfigError(
      404,
      "TRACE_NOT_FOUND",
      "Execution trace was not found",
    );
  return r.data;
}
router.get(
  "/traces",
  privileged(async (req, res) => {
    const f = filtersSchema.parse(req.query),
      db = getSupabaseAdmin();
    const denial = await checkTenantReferences(db, req.orgId!, [
      ["agents", f.agentId],
      ["devices", f.deviceId],
      ["conversations", f.conversationId],
    ]);
    if (denial) throw new ConfigError(denial.status, denial.code, denial.error);
    let q = db
      .from("execution_traces")
      .select(
        "id,source,status,device_id,conversation_id,agent_id,agent_version_id,created_at,evidence",
      )
      .eq("org_id", req.orgId!);
    if (f.agentId) q = q.eq("agent_id", f.agentId);
    if (f.deviceId) q = q.eq("device_id", f.deviceId);
    if (f.conversationId) q = q.eq("conversation_id", f.conversationId);
    if (f.status) q = q.eq("status", f.status);
    if (f.cursor) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(
          Buffer.from(f.cursor, "base64url").toString("utf8"),
        );
      } catch {
        throw new ConfigError(400, "INVALID_CURSOR", "Invalid history cursor");
      }
      const c = cursorSchema.parse(decoded);
      q = q.or(
        `created_at.lt.${c.time},and(created_at.eq.${c.time},id.lt.${c.id})`,
      );
    }
    const r = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(f.limit + 1);
    if (r.error) databaseError(r.error);
    await access(req, "trace.list", null);
    const rows = (r.data ?? []).slice(0, f.limit),
      last = rows.at(-1);
    res.json({
      success: true,
      data: rows,
      nextCursor:
        (r.data ?? []).length > f.limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.created_at, id: last.id }),
            ).toString("base64url")
          : null,
    });
  }),
);
router.get(
  "/traces/:id",
  privileged(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const row = await ownedTrace(req.orgId!, id);
    await access(req, "trace.read", id);
    res.json({ success: true, data: row });
  }),
);
router.get(
  "/messages/:id",
  privileged(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id),
      db = getSupabaseAdmin();
    const m = await db
      .from("messages")
      .select("metadata,conversation_id")
      .eq("org_id", req.orgId!)
      .eq("id", id)
      .eq("direction", "outbound")
      .eq("sender_type", "ai")
      .maybeSingle();
    if (m.error) databaseError(m.error);
    if (!m.data)
      throw new ConfigError(
        404,
        "MESSAGE_NOT_FOUND",
        "AI message was not found",
      );
    const denial = await checkTenantReferences(db, req.orgId!, [
      ["conversations", m.data.conversation_id],
    ]);
    if (denial)
      throw new ConfigError(
        404,
        "MESSAGE_NOT_FOUND",
        "AI message was not found",
      );
    const traceId = z
      .string()
      .uuid()
      .safeParse(m.data.metadata?.executionTraceId);
    if (!traceId.success)
      throw new ConfigError(
        404,
        "TRACE_NOT_FOUND",
        "This message has no retained execution trace",
      );
    const row = await ownedTrace(req.orgId!, traceId.data);
    if (
      row.conversation_id !== m.data.conversation_id ||
      row.outbound_message_id !== id
    )
      throw new ConfigError(
        404,
        "TRACE_NOT_FOUND",
        "Execution trace was not found",
      );
    await access(req, "trace.message", row.id);
    res.json({ success: true, data: row });
  }),
);
router.get(
  "/audit",
  privileged(async (req, res) => {
    const f = filtersSchema
      .pick({ limit: true, cursor: true })
      .parse(req.query);
    let q = getSupabaseAdmin()
      .from("audit_logs")
      .select("*")
      .eq("org_id", req.orgId!);
    if (f.cursor) {
      let c;
      try {
        c = cursorSchema.parse(
          JSON.parse(Buffer.from(f.cursor, "base64url").toString("utf8")),
        );
      } catch {
        throw new ConfigError(400, "INVALID_CURSOR", "Invalid history cursor");
      }
      q = q.or(
        `created_at.lt.${c.time},and(created_at.eq.${c.time},id.lt.${c.id})`,
      );
    }
    const r = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(f.limit + 1);
    if (r.error) databaseError(r.error);
    await access(req, "audit.list", null);
    const rows = (r.data ?? []).slice(0, f.limit),
      last = rows.at(-1);
    res.json({
      success: true,
      data: rows,
      nextCursor:
        (r.data ?? []).length > f.limit && last
          ? Buffer.from(
              JSON.stringify({ time: last.created_at, id: last.id }),
            ).toString("base64url")
          : null,
    });
  }),
);
export default router;
