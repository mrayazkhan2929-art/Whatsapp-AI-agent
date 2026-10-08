import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types.js";
import { recordAudit } from "../../modules/observability/AuditLogService.js";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function auditMutation(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  if (req.auth && ["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) {
    const auth = req.auth;

    const resource = req.baseUrl.split("/")[3] ?? "unknown";
    const id = req.path.split("/").find((part) => uuid.test(part)) ?? null;
    const fields = Object.keys(
      req.body && typeof req.body === "object" ? req.body : {},
    )
      .filter(
        (key) =>
          /^[a-zA-Z][a-zA-Z0-9_]{0,40}$/.test(key) &&
          !/secret|password|token|key|cookie|authorization/i.test(key),
      )
      .slice(0, 30);
    res.once("finish", () => {
      void recordAudit(
        auth,
        req.method.toLowerCase() + "." + resource,
        resource.slice(0, 80),
        id,
        {
          method: req.method,
          statusCode: res.statusCode,
          changedFields: fields,
        },
        res.statusCode,
      );
    });
  }
  next();
}
