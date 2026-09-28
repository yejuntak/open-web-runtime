import type { RuntimeFailure, RuntimeFailureCode } from "./types.js";

export type FailureHint = "planner" | "browser";

function failure(code: RuntimeFailureCode, message: string, retryable: boolean): RuntimeFailure {
  return { code, message, retryable };
}

export function classifyRuntimeError(error: unknown, hint?: FailureHint): RuntimeFailure {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (hint === "planner") return failure("planner_error", message, false);
  if (/private\/local|protocol .* not allowed|url-embedded credentials|absolute url/.test(lower)) {
    return failure("policy_denied", message, false);
  }
  if (/no longer exists|not present in the latest observation|stale/.test(lower)) {
    return failure("stale_target", message, true);
  }
  if (/not visible|no layout box|click target/.test(lower)) {
    return failure("target_not_visible", message, true);
  }
  if (/disabled/.test(lower)) return failure("target_disabled", message, false);
  if (/uniquely resolve|ambiguous/.test(lower)) return failure("ambiguous_target", message, false);
  if (/timeout|timed out/.test(lower)) return failure("navigation_timeout", message, true);
  if (/net::|network|econn|enotfound|eai_again/.test(lower)) return failure("network", message, true);
  if (/browser.*closed|target.*closed|page.*closed|session.*closed/.test(lower)) {
    return failure("browser_closed", message, false);
  }
  if (/unsupported action|invalid .*action|expected .*string|expected an object/.test(lower)) {
    return failure("invalid_action", message, false);
  }
  if (hint === "browser") return failure("browser_error", message, false);
  return failure("unknown", message, false);
}

export class RuntimeFailureError extends Error {
  constructor(readonly failure: RuntimeFailure) {
    super(failure.message);
    this.name = "RuntimeFailureError";
  }
}
