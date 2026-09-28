import type { AgentAction, PageObservation } from "./types.js";

export type PolicyDecision =
  | { kind: "allow" }
  | { kind: "confirm"; reason: string }
  | { kind: "deny"; reason: string };

const CONSEQUENCE_TERMS = [
  "buy", "purchase", "place order", "pay", "transfer", "send money",
  "delete", "submit application", "accept offer", "publish", "sign"
];

function blockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  const v4 = h.match(/^172\.(\d+)\./);
  if (v4 && Number(v4[1]) >= 16 && Number(v4[1]) <= 31) return true;
  if (h === "::1" || h.startsWith("fc") || h.startsWith("fd") || h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true;
  return false;
}

export function navigationPolicy(url: string, allowPrivateNetworks = false): PolicyDecision {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { kind: "deny", reason: "Navigation target must be an absolute URL." }; }
  if (!["http:", "https:"].includes(parsed.protocol)) return { kind: "deny", reason: `Protocol ${parsed.protocol} is not allowed.` };
  if (parsed.username || parsed.password) return { kind: "deny", reason: "URL-embedded credentials are not allowed." };
  if (!allowPrivateNetworks && blockedHost(parsed.hostname)) return { kind: "deny", reason: "Private/local network navigation is disabled." };
  return { kind: "allow" };
}

export function actionPolicy(action: AgentAction, observation: PageObservation, requireConfirmation = true): PolicyDecision {
  if (!requireConfirmation || !("nodeId" in action)) return { kind: "allow" };
  const node = observation.nodes.find(candidate => candidate.id === action.nodeId);
  if (!node) return { kind: "deny", reason: "The action references a node that is not in the current observation." };
  if (node.disabled) return { kind: "deny", reason: "The target control is disabled." };
  const surface = `${node.name} ${node.text}`.toLowerCase();
  const term = CONSEQUENCE_TERMS.find(candidate => surface.includes(candidate));
  return term
    ? { kind: "confirm", reason: `Potentially consequential control contains “${term}”.` }
    : { kind: "allow" };
}
