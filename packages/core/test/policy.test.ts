import test from "node:test";
import assert from "node:assert/strict";
import { actionPolicy, navigationPolicy, parseAgentAction, type PageObservation } from "../src/index.js";

test("navigation policy blocks local and credentialed URLs", () => {
  assert.equal(navigationPolicy("http://localhost:3000").kind, "deny");
  assert.equal(navigationPolicy("http://169.254.169.254/latest/meta-data").kind, "deny");
  assert.equal(navigationPolicy("https://user:pass@example.com").kind, "deny");
  assert.equal(navigationPolicy("https://example.com").kind, "allow");
});

test("consequential semantic controls require approval", () => {
  const observation: PageObservation = {
    url: "https://shop.example",
    title: "Checkout",
    timestamp: new Date().toISOString(),
    textPreview: "",
    accessibilitySummary: [],
    nodes: [{
      id: "b42",
      role: "button",
      name: "Place order",
      tag: "button",
      text: "Place order",
      disabled: false,
      visible: true,
      actions: ["click"]
    }]
  };
  assert.equal(actionPolicy({ type: "click", nodeId: "b42" }, observation).kind, "confirm");
});

test("planner actions reject arbitrary action types", () => {
  assert.throws(() => parseAgentAction({ type: "evaluate", script: "1+1" }), /Unsupported action type/);
});
