import test from "node:test";
import assert from "node:assert/strict";
import { diffObservations, semanticKeyForNode, type PageObservation, type SemanticNode } from "../src/index.js";

function node(id: string, value: string): SemanticNode {
  const base: SemanticNode = {
    id,
    role: "textbox",
    name: "Email",
    tag: "input",
    text: "",
    value,
    disabled: false,
    visible: true,
    actions: ["type", "focus"]
  };
  base.semanticKey = semanticKeyForNode(base);
  return base;
}

function observation(url: string, nodes: SemanticNode[]): PageObservation {
  return {
    url,
    title: "Checkout",
    timestamp: new Date().toISOString(),
    nodes,
    textPreview: "",
    accessibilitySummary: []
  };
}

test("semantic diff matches a unique control across backend-node id changes", () => {
  const before = observation("https://example.com/a", [node("b10", "old@example.com")]);
  const after = observation("https://example.com/b", [node("b99", "new@example.com")]);

  const diff = diffObservations(before, after);

  assert.equal(diff.urlChanged, true);
  assert.equal(diff.added.length, 0);
  assert.equal(diff.removed.length, 0);
  assert.equal(diff.changed.length, 1);
  assert.equal(diff.changed[0]?.beforeId, "b10");
  assert.equal(diff.changed[0]?.afterId, "b99");
  assert.deepEqual(diff.changed[0]?.fields, ["value"]);
});

test("ambiguous duplicate semantic controls are not guessed across id changes", () => {
  const before = observation("https://example.com", [node("b1", ""), node("b2", "")]);
  const after = observation("https://example.com", [node("b3", ""), node("b4", "")]);

  const diff = diffObservations(before, after);

  assert.equal(diff.changed.length, 0);
  assert.equal(diff.added.length, 2);
  assert.equal(diff.removed.length, 2);
});
