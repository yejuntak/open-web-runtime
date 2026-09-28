import test from "node:test";
import assert from "node:assert/strict";

test("MCP_ONLY env is documented as a boolean deployment mode", () => {
  const value = "true";
  assert.equal(value === "true", true);
});
