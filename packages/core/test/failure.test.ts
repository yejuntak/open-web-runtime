import test from "node:test";
import assert from "node:assert/strict";
import { classifyRuntimeError } from "../src/index.js";

test("failure taxonomy marks stale and timeout failures as retryable", () => {
  assert.deepEqual(classifyRuntimeError(new Error("Semantic node b2 is not present in the latest observation"), "browser"), {
    code: "stale_target",
    message: "Semantic node b2 is not present in the latest observation",
    retryable: true
  });
  assert.equal(classifyRuntimeError(new Error("page.goto: Timeout 45000ms exceeded"), "browser").code, "navigation_timeout");
  assert.equal(classifyRuntimeError(new Error("page.goto: Timeout 45000ms exceeded"), "browser").retryable, true);
});

test("planner failures are classified separately and are not blindly retried", () => {
  const failure = classifyRuntimeError(new Error("invalid JSON"), "planner");
  assert.equal(failure.code, "planner_error");
  assert.equal(failure.retryable, false);
});
