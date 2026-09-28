import test from "node:test";
import assert from "node:assert/strict";
import { OpenAICompatiblePlanner, type PlannerContext } from "../src/index.js";

const context: PlannerContext = {
  goal: "finish",
  step: 1,
  observation: {
    url: "https://example.com",
    title: "Example",
    timestamp: "2026-09-28T00:00:00.000Z",
    textPreview: "Example",
    accessibilitySummary: [],
    nodes: []
  },
  history: []
};

test("Responses API planner sends input_text messages and parses output_text", async () => {
  let requestedUrl = "";
  let requestedBody;
  const planner = new OpenAICompatiblePlanner({
    baseUrl: "https://api.example/v1",
    apiKey: "key",
    model: "model",
    apiMode: "responses",
    fetchImpl: async (input, init) => {
      requestedUrl = String(input);
      requestedBody = JSON.parse(String(init?.body ?? "{}"));
      return new Response(JSON.stringify({
        output: [{ type: "message", content: [{ type: "output_text", text: '{"type":"complete","result":{"ok":true}}' }] }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  const action = await planner.next(context);

  assert.equal(requestedUrl, "https://api.example/v1/responses");
  assert.equal(requestedBody.input[1].content[0].type, "input_text");
  assert.deepEqual(action, { type: "complete", result: { ok: true } });
});

test("Chat Completions mode remains available for compatible providers", async () => {
  let requestedUrl = "";
  const planner = new OpenAICompatiblePlanner({
    baseUrl: "https://compatible.example/v1/",
    apiKey: "key",
    model: "model",
    apiMode: "chat_completions",
    fetchImpl: async input => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"type":"wait","ms":100}' } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });

  assert.deepEqual(await planner.next(context), { type: "wait", ms: 100 });
  assert.equal(requestedUrl, "https://compatible.example/v1/chat/completions");
});
