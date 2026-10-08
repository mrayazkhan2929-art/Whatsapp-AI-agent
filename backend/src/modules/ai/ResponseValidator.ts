import type { RouteResult } from "./router.js";

/** Centralized, finite content gates. Database authorization remains independent. */
export function sanitize(text: string): string {
  return text
    .replace(/\[team[- ]verified[^\]]*\]/gi, "")
    .replace(/\{[A-Z_]{2,}\}/g, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s/gm, "")
    .replace(/\+971[\s\d-]*[xX]{2,}[\d\s-]*/g, "")
    .replace(/Thanks for your patience[^.!?]*[.!?]/gi, "")
    .replace(/One of our property specialists will follow up[^.!?]*[.!?]/gi, "")
    .replace(/property specialist[s]? will follow[^.!?]*[.!?]/gi, "")
    .replace(/I'll be happy to follow up[^.!?]*[.!?]/gi, "")
    .replace(/I'll need to check with our team[^.!?]*[.!?]/gi, "")
    .replace(/I need to verify this information[^.!?]*[.!?]/gi, "")
    .replace(/Allow me a moment to check[^.!?]*[.!?]/gi, "")
    .replace(/I only speak English[^.!?]*[.!?]/gi, "")
    .replace(/\*Property\s+\d+\*/gi, "")
    .replace(/Property\s+\d+/gi, "")
    .replace(/Starting from AED\s*[\d,]+/gi, "")
    .replace(/Prices?\s+start(?:ing)?\s+around\s+AED\s*[\d,]+/gi, "")
    .replace(/Would you like me to check availability[^.!?]*[.!?]/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
export interface ValidationGate {
  name: string;
  passed: boolean;
}
export class ResponseValidator {
  validate(
    reply: string,
    route: Pick<RouteResult, "lang" | "lane" | "propertiesFound">,
    dryRun = false,
  ) {
    const gates: ValidationGate[] = [
      { name: "nonempty", passed: !!reply.trim() },
      {
        name: "no_legacy_handoff_claim",
        passed:
          !/thanks for your patience|property specialist.*follow up/i.test(
            reply,
          ),
      },
      {
        name: "no_legacy_property_formatter",
        passed:
          !/\*?\s*Property\s+\d+\s*\*?|Starting from AED|Prices?\s+start(?:ing)?\s+around/i.test(
            reply,
          ),
      },
      {
        name: "language_capability",
        passed: !/i only speak english|لا.*الإنجليزية فقط/i.test(reply),
      },
      {
        name: "arabic_response",
        passed: route.lang !== "ar" || /[\u0600-\u06ff]/.test(reply),
      },
      {
        name: "no_price_without_inventory",
        passed:
          route.lane !== "PROPERTY" ||
          (route.propertiesFound ?? 0) > 0 ||
          !/AED\s*[\d,]+|starting from|prices? (start|from)/i.test(reply),
      },
      {
        name: "no_platform_secret",
        passed:
          !/\b(?:sk|gsk|sb_secret)[-_][A-Za-z0-9_-]{8,}|Bearer\s+\S+/i.test(
            reply,
          ),
      },
    ];
    if (dryRun)
      gates.push({
        name: "no_dry_run_action_claim",
        passed:
          !/(?:I (?:have )?(?:booked|updated|sent|created)|appointment (?:is |has been )?confirmed|تم (?:حجز|إرسال|تحديث))/i.test(
            reply,
          ),
      });
    return {
      passed: gates.every((g) => g.passed),
      reason: gates.find((g) => !g.passed)?.name,
      gates,
    };
  }
}
export const responseValidator = new ResponseValidator();
