import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryArtifactStore } from "../src/index.js";

test("artifact store copies bytes and evicts the oldest artifact per task", () => {
  const store = new InMemoryArtifactStore(2, 100);
  const source = new Uint8Array([1, 2, 3]);

  const first = store.put({ taskId: "t1", kind: "screenshot", mimeType: "image/jpeg", data: source, label: "one" });
  store.put({ taskId: "t1", kind: "screenshot", mimeType: "image/jpeg", data: new Uint8Array([4]), label: "two" });
  const third = store.put({ taskId: "t1", kind: "screenshot", mimeType: "image/jpeg", data: new Uint8Array([5]), label: "three" });

  source[0] = 99;

  assert.equal(store.get(first.id), undefined);
  assert.equal(store.list("t1").length, 2);
  assert.equal(store.list("t1")[1]?.id, third.id);
  assert.deepEqual([...store.get(third.id)!.data], [5]);
});

test("artifact store rejects oversized artifacts", () => {
  const store = new InMemoryArtifactStore(2, 2);
  assert.throws(
    () => store.put({ taskId: "t1", kind: "screenshot", mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) }),
    /exceeds/
  );
});

test("live frame channel keeps only the newest frame and increments sequence", () => {
  const store = new InMemoryArtifactStore(2, 100);
  const first = store.setLiveFrame("t1", { data: new Uint8Array([1]), mimeType: "image/jpeg", capturedAt: "2026-09-28T00:00:00.000Z" });
  const second = store.setLiveFrame("t1", { data: new Uint8Array([2, 3]), mimeType: "image/jpeg", capturedAt: "2026-09-28T00:00:01.000Z" });

  assert.equal(first.sequence, 1);
  assert.equal(second.sequence, 2);
  assert.deepEqual([...store.getLiveFrame("t1")!.data], [2, 3]);

  store.clearLiveFrame("t1");
  assert.equal(store.getLiveFrame("t1"), undefined);
});
