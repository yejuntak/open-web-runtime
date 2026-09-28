import test from "node:test";
import assert from "node:assert/strict";
import { WebFetcher, type BrowserProvider, type WebDocument } from "../src/index.js";

test("web fetcher blocks private network navigation before opening a browser", async () => {
  let created = 0;
  const provider: BrowserProvider = {
    async createSession() {
      created += 1;
      throw new Error("should not open");
    }
  };
  const fetcher = new WebFetcher(provider);
  await assert.rejects(() => fetcher.fetch({ url: "http://127.0.0.1/admin" }), /Private\/local/);
  assert.equal(created, 0);
});

test("web fetcher bounds extracted text and links", async () => {
  const document: WebDocument = {
    url: "https://example.com",
    title: "Example",
    text: "x".repeat(5000),
    links: Array.from({ length: 600 }, (_, index) => ({ text: String(index), href: "https://example.com/" + index })),
    fetchedAt: "2026-09-28T00:00:00.000Z"
  };
  const provider: BrowserProvider = {
    async createSession() {
      return {
        backend: "fake",
        async observe() { throw new Error("unused"); },
        async execute() {},
        async extractDocument() { return document; },
        async close() {}
      };
    }
  };

  const result = await new WebFetcher(provider).fetch({
    url: "https://example.com",
    settleMs: 0,
    maxTextChars: 1000
  });

  assert.equal(result.text.length, 1000);
  assert.equal(result.links.length, 500);
});
