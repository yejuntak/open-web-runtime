import test from "node:test";
import assert from "node:assert/strict";
import { SearxngSearchProvider } from "../src/index.js";

test("SearXNG adapter encodes queries, deduplicates URLs, and bounds results", async () => {
  let requested = "";
  const provider = new SearxngSearchProvider({
    baseUrl: "https://search.example/",
    fetchImpl: async input => {
      requested = String(input);
      return new Response(JSON.stringify({
        results: [
          { title: "A", url: "https://a.example/", content: "one", engine: "alpha" },
          { title: "A duplicate", url: "https://a.example/", content: "dup", engine: "beta" },
          { title: "B", url: "https://b.example/", content: "two", engines: ["alpha", "beta"] }
        ]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const results = await provider.search("web agents & browsers", 2);

  assert.match(requested, /format=json/);
  assert.match(requested, /web\+agents|web%20agents/);
  assert.equal(results.length, 2);
  assert.equal(results[0]?.url, "https://a.example/");
  assert.deepEqual(results[1]?.sources, ["alpha", "beta"]);
});
