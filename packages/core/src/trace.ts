import type { AgentAction, RecordedAgentAction } from "./types.js";

export function redactUrlForTrace(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

export function redactAgentAction(action: AgentAction): RecordedAgentAction {
  switch (action.type) {
    case "navigate":
      return { type: "navigate", url: redactUrlForTrace(action.url) };
    case "click":
      return { type: "click", nodeId: action.nodeId };
    case "type":
      return { type: "type", nodeId: action.nodeId, textLength: action.text.length, submit: action.submit };
    case "select":
      return { type: "select", nodeId: action.nodeId, valueLength: action.value.length };
    case "press":
      return { type: "press", key: action.key };
    case "scroll":
      return { type: "scroll", direction: action.direction, amount: action.amount };
    case "wait":
      return { type: "wait", ms: action.ms };
    case "complete":
      return { type: "complete", ...(action.summary ? { summary: action.summary } : {}) };
  }
}
