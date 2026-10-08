import {
  getSupabaseAdmin,
  isSupabaseConfigured,
} from "../../config/supabase.js";
import type { AuthContext } from "../../api/types.js";
export async function recordAudit(
  auth: AuthContext,
  action: string,
  resourceType: string,
  resourceId: string | null,
  details: Record<string, unknown>,
  status = 200,
) {
  if (!isSupabaseConfigured()) return false;
  try {
    const { error } = await getSupabaseAdmin()
      .from("audit_logs")
      .insert({
        org_id: auth.orgId,
        actor_id: auth.userId,
        action,
        resource_type: resourceType,
        resource_id: resourceId,
        outcome:
          status < 400 ? "succeeded" : status < 500 ? "denied" : "failed",
        details,
      });
    if (error) throw new Error("Audit unavailable");
    return true;
  } catch {
    console.error(JSON.stringify({ tag: "AUDIT_LOG_UNAVAILABLE", action }));
    return false;
  }
}
