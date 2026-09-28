import test from "node:test";
import assert from "node:assert/strict";
import { BrowserSessionRegistry, type BrowserProvider, type PageObservation } from "../src/index.js";

const checkout: PageObservation = {
  url: "https://shop.example/checkout",
  title: "Checkout",
  timestamp: "2026-09-28T00:00:00.000Z",
  textPreview: "",
  accessibilitySummary: [],
  nodes: [{
    id: "b4",
    role: "button",
    name: "Place order",
    tag: "button",
    text: "Place order",
    disabled: false,
    visible: true,
    actions: ["click"]
  }]
};

test("direct browser actions preserve the consequential-action gate", async () => {
  let clicks = 0;
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { return checkout; },
        async execute(action) { if (action.type === "click") clicks += 1; },
        async close() {}
      };
    }
  };

  const registry = new BrowserSessionRegistry(provider);
  const session = await registry.create();

  const first = await registry.act(session.id, { type: "click", nodeId: "b4" });
  assert.deepEqual(first, { executed: false, confirmationRequired: "Potentially consequential control contains “place order”." });
  assert.equal(clicks, 0);

  const confirmed = await registry.act(session.id, { type: "click", nodeId: "b4" }, true);
  assert.equal(confirmed.executed, true);
  assert.equal(clicks, 1);
});

test("private start URLs are rejected before browser creation", async () => {
  let created = 0;
  const provider: BrowserProvider = {
    async createSession() {
      created += 1;
      throw new Error("should not create");
    }
  };
  const registry = new BrowserSessionRegistry(provider);
  await assert.rejects(() => registry.create("http://localhost:8080"), /Private\/local/);
  assert.equal(created, 0);
});

test("expired sessions are closed by the registry sweeper", async () => {
  let closed = 0;
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { return checkout; },
        async execute() {},
        async close() { closed += 1; }
      };
    }
  };
  const registry = new BrowserSessionRegistry(provider, { ttlMs: 100 });
  const session = await registry.create();
  const removed = await registry.sweepExpired(Date.parse(session.lastUsedAt) + 101);

  assert.equal(removed, 1);
  assert.equal(closed, 1);
  assert.equal(registry.getMetadata(session.id), undefined);
});
