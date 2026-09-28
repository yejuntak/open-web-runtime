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
