import test from "node:test";
import assert from "node:assert/strict";
import { buildSemanticPageGraph } from "../src/semantic.js";

test("CDP snapshot becomes a bounded semantic control graph", () => {
  const strings = ["#document", "HTML", "BODY", "BUTTON", "#text", "Checkout", "type", "button"];
  const observation = buildSemanticPageGraph({
    url: "https://shop.example/checkout",
    title: "Checkout",
    timestamp: "2026-09-28T00:00:00.000Z",
    snapshot: {
      strings,
      documents: [{
        nodes: {
          parentIndex: [-1, 0, 1, 2, 3],
          nodeType: [9, 1, 1, 1, 3],
          nodeName: [0, 1, 2, 3, 4],
          nodeValue: [0, 0, 0, 0, 5],
          backendNodeId: [1, 2, 3, 44, 45],
          attributes: [[], [], [], [6, 7], []],
          isClickable: { index: [3] }
        },
        layout: {
          nodeIndex: [1, 2, 3, 4],
          bounds: [[0, 0, 1000, 800], [0, 0, 1000, 800], [100, 100, 120, 44], [110, 110, 90, 20]]
        }
      }]
    },
    axTree: {
      nodes: [{ backendDOMNodeId: 44, role: { value: "button" }, name: { value: "Checkout" } }]
    },
    textPreview: "Checkout"
  });

  assert.equal(observation.nodes.length, 1);
  assert.equal(observation.nodes[0]?.id, "b44");
  assert.equal(observation.nodes[0]?.name, "Checkout");
  assert.deepEqual(observation.nodes[0]?.actions, ["click"]);
});
