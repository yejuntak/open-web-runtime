import test from "node:test";
import assert from "node:assert/strict";
import { redactAgentAction } from "../src/index.js";

test("trace redaction never persists typed text or select values", () => {
  const typed = redactAgentAction({ type: "type", nodeId: "b2", text: "super-secret", submit: true });
  const selected = redactAgentAction({ type: "select", nodeId: "b3", value: "private-choice" });

  assert.deepEqual(typed, { type: "type", nodeId: "b2", textLength: 12, submit: true });
  assert.deepEqual(selected, { type: "select", nodeId: "b3", valueLength: 14 });
  assert.equal(JSON.stringify([typed, selected]).includes("super-secret"), false);
  assert.equal(JSON.stringify([typed, selected]).includes("private-choice"), false);
});

test("trace navigation strips credentials, query parameters, and fragments", () => {
  const action = redactAgentAction({
    type: "navigate",
    url: "https://user:pass@example.com/path?token=secret#fragment"
  });

  assert.deepEqual(action, { type: "navigate", url: "https://example.com/path" });
});
