import { parseAgentAction, type AgentAction, type Planner, type PlannerContext } from "./types.js";

export type OpenAICompatiblePlannerOptions = { baseUrl: string; apiKey: string; model: string };

const SYSTEM_PROMPT = `You are a browser execution planner.
Return exactly one JSON object and no prose.
Allowed actions:
{"type":"navigate","url":"https://..."}
{"type":"click","nodeId":"b..."}
{"type":"type","nodeId":"b...","text":"...","submit":false}
{"type":"select","nodeId":"b...","value":"..."}
{"type":"press","key":"Enter"}
{"type":"scroll","direction":"down","amount":700}
{"type":"wait","ms":1000}
{"type":"complete","result":...,"summary":"..."}

Never invent node IDs. Use only semantic node IDs in the current observation.
The changeSummary describes state changes since the previous planning step. Treat it as evidence, not as a separate source of actionable node IDs.
Prefer semantic controls. Do not repeat failed actions without evidence the state changed.
If the goal is satisfied, complete immediately.
Do not output chain-of-thought.`;

function compact(context: PlannerContext) {
  const changeSummary = context.diff ? {
    urlChanged: context.diff.urlChanged,
    titleChanged: context.diff.titleChanged,
    unchangedCount: context.diff.unchangedCount,
    added: context.diff.added.slice(0, 40).map(node => ({
      id: node.id, semanticKey: node.semanticKey, role: node.role, name: node.name, disabled: node.disabled, actions: node.actions
    })),
    removed: context.diff.removed.slice(0, 40).map(node => ({
      semanticKey: node.semanticKey, role: node.role, name: node.name
    })),
    changed: context.diff.changed.slice(0, 40).map(change => ({
      semanticKey: change.semanticKey,
      beforeId: change.beforeId,
      afterId: change.afterId,
      fields: change.fields,
      name: change.after.name,
      value: change.fields.includes("value") ? change.after.value : undefined,
      disabled: change.after.disabled,
      actions: change.after.actions
    }))
  } : undefined;

  return {
    goal: context.goal,
    step: context.step,
    page: {
      url: context.observation.url,
      title: context.observation.title,
      textPreview: context.observation.textPreview.slice(0, 6000),
      nodes: context.observation.nodes.slice(0, 140).map(node => ({
        id: node.id,
        semanticKey: node.semanticKey,
        role: node.role,
        name: node.name,
        text: node.text.slice(0, 160),
        href: node.href,
        disabled: node.disabled,
        actions: node.actions
      }))
    },
    changeSummary,
    recentHistory: context.history.slice(-6).map(step => ({
      step: step.step, action: step.action, ok: step.ok, error: step.error, failure: step.failure, after: step.after
    }))
  };
}

export class OpenAICompatiblePlanner implements Planner {
  constructor(private options: OpenAICompatiblePlannerOptions) {}

  async next(context: PlannerContext): Promise<AgentAction> {
    if (!this.options.apiKey) throw new Error("LLM_API_KEY is required");
    const response = await fetch(`${this.options.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        model: this.options.model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(compact(context)) }
        ]
      })
    });
    if (!response.ok) throw new Error(`Planner HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content?.trim();
    if (!raw) throw new Error("Planner returned no action");
    return parseAgentAction(JSON.parse(raw.replace(/^\x60\x60\x60(?:json)?\s*/i, "").replace(/\s*\x60\x60\x60$/, "")));
  }
}
