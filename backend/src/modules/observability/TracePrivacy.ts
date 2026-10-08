import { createHash } from "node:crypto";
import { criteriaFromLegacy } from "../../properties/PropertySearchCriteria.js";

export const textDigest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export function redactEvidence(text: string): string {
  return text
    .replace(
      /Bearer\s+\S+|\b(?:sk|gsk|sb_secret)[-_][A-Za-z0-9_-]+/gi,
      "[secret]",
    )
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[token]")
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\+\d[\d ()-]{7,}\d/g, "[phone]")
    .replace(/\b\d{11,15}\b/g, "[identifier]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .slice(0, 2000);
}
export function safeCriteria(value: Record<string, unknown>) {
  const criteria = criteriaFromLegacy(value);
  return {
    ...Object.fromEntries(
      Object.entries(criteria).map(([key, item]) => [
        key,
        typeof item === "string"
          ? redactEvidence(item)
          : Array.isArray(item)
            ? item.slice(-50).map((v) => redactEvidence(String(v)))
            : item,
      ]),
    ),
    ...(criteria.excludeRefs.length > 50
      ? { omittedExcludeRefsCount: criteria.excludeRefs.length - 50 }
      : {}),
  };
}
export function safeEvidence(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[bounded]";
  if (typeof value === "string") return redactEvidence(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => safeEvidence(item, depth + 1));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) =>
            !/^(phone|email|jid|customer|contact|content|message|prompt|system|apiKey|password|authorization|cookie|secret|accessToken)$/i.test(
              key,
            ),
        )
        .slice(0, 50)
        .map(([key, item]) => [key, safeEvidence(item, depth + 1)]),
    );
  return null;
}
