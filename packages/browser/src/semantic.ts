import type { CDPSession, Page } from "playwright-core";
import type { PageObservation, SemanticNode } from "@owr/core";

const MAX_NODES = 180;
const MAX_TEXT_PREVIEW = 9000;
const MAX_NODE_TEXT = 500;

export type SnapshotLike = {
  strings: string[];
  documents: Array<{
    nodes: {
      parentIndex: number[];
      nodeType: number[];
      nodeName: number[];
      nodeValue: number[];
      backendNodeId: number[];
      attributes: number[][];
      isClickable?: { index?: number[] };
      inputValue?: { index?: number[]; value?: number[] };
    };
    layout: { nodeIndex: number[]; bounds: number[][] };
  }>;
};

type AxNodeLike = {
  ignored?: boolean;
  backendDOMNodeId?: number;
  role?: { value?: unknown };
  name?: { value?: unknown };
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
};

type AxTreeLike = { nodes?: AxNodeLike[] };
type AxSemantic = { role?: string; name?: string; disabled?: boolean };

function stringAt(strings: string[], index: number | undefined): string {
  return typeof index === "number" && index >= 0 ? (strings[index] ?? "") : "";
}

function attrsFor(strings: string[], encoded: number[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; encoded && i + 1 < encoded.length; i += 2) {
    const name = stringAt(strings, encoded[i]).toLowerCase();
    if (name) out[name] = stringAt(strings, encoded[i + 1]);
  }
  return out;
}

function rareStringMap(data: { index?: number[]; value?: number[] } | undefined): Map<number, number> {
  const out = new Map<number, number>();
  const index = data?.index ?? [];
  const value = data?.value ?? [];
  for (let i = 0; i < Math.min(index.length, value.length); i += 1) out.set(index[i]!, value[i]!);
  return out;
}

function buildAxMap(tree: AxTreeLike | undefined): Map<number, AxSemantic> {
  const out = new Map<number, AxSemantic>();
  for (const node of tree?.nodes ?? []) {
    if (node.ignored || !node.backendDOMNodeId) continue;
    const disabled = node.properties?.find(property => property.name === "disabled")?.value?.value;
    out.set(node.backendDOMNodeId, {
      ...(typeof node.role?.value === "string" ? { role: node.role.value } : {}),
      ...(typeof node.name?.value === "string" ? { name: node.name.value } : {}),
      ...(disabled === true ? { disabled: true } : {})
    });
  }
  return out;
}

function inferRole(tag: string, attrs: Record<string, string>, ax?: AxSemantic): string {
  if (ax?.role && ax.role !== "generic") return ax.role;
  if (attrs.role) return attrs.role;
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return "combobox";
  if (tag === "option") return "option";
  if (tag === "input") {
    const type = (attrs.type || "text").toLowerCase();
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    return "textbox";
  }
  return tag;
}

function isInteractive(tag: string, role: string, attrs: Record<string, string>, clickable: boolean): boolean {
  if (clickable || ["a", "button", "input", "textarea", "select", "summary"].includes(tag)) return true;
  if (attrs.contenteditable === "true") return true;
  if (attrs.tabindex !== undefined && attrs.tabindex !== "-1") return true;
  return ["button", "link", "textbox", "combobox", "checkbox", "radio", "slider", "switch", "tab", "menuitem", "option"].includes(role);
}

function actionsFor(tag: string, role: string, attrs: Record<string, string>, disabled: boolean, clickable: boolean): SemanticNode["actions"] {
  if (disabled) return [];
  const actions: SemanticNode["actions"] = [];
  if (clickable || ["a", "button", "summary"].includes(tag) || ["button", "link", "checkbox", "radio", "switch", "tab", "menuitem"].includes(role)) actions.push("click");
  if (tag === "input" || tag === "textarea" || attrs.contenteditable === "true" || role === "textbox") actions.push("type", "focus");
  if (tag === "select" || role === "combobox") actions.push("select", "focus");
  return [...new Set(actions)];
}

function semanticName(attrs: Record<string, string>, ax: AxSemantic | undefined, text: string): string {
  return [ax?.name, attrs["aria-label"], attrs.title, attrs.placeholder, attrs.name, attrs.alt, text]
    .find(value => typeof value === "string" && value.trim())?.trim().slice(0, 240) ?? "";
}

function descendantText(strings: string[], nodeType: number[], nodeValue: number[], parentIndex: number[]): string[] {
  const out = Array.from({ length: nodeType.length }, () => "");
  for (let i = 0; i < nodeType.length; i += 1) {
    if (nodeType[i] !== 3) continue;
    const value = stringAt(strings, nodeValue[i]).replace(/\s+/g, " ").trim();
    if (!value) continue;
    let parent = parentIndex[i] ?? -1;
    let depth = 0;
    while (parent >= 0 && depth < 12) {
      if (out[parent]!.length < MAX_NODE_TEXT) out[parent] = (`${out[parent]} ${value}`).trim().slice(0, MAX_NODE_TEXT);
      parent = parentIndex[parent] ?? -1;
      depth += 1;
    }
  }
  return out;
}

function absoluteHref(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try { return new URL(href, base).toString(); } catch { return href; }
}

export function buildSemanticPageGraph(input: {
  snapshot: SnapshotLike;
  axTree?: AxTreeLike;
  url: string;
  title: string;
  textPreview?: string;
  timestamp?: string;
}): PageObservation {
  const ax = buildAxMap(input.axTree);
  const nodes: SemanticNode[] = [];

  for (const document of input.snapshot.documents) {
    const dom = document.nodes;
    const layout = new Map<number, number[]>();
    for (let i = 0; i < document.layout.nodeIndex.length; i += 1) {
      const nodeIndex = document.layout.nodeIndex[i];
      const bounds = document.layout.bounds[i];
      if (typeof nodeIndex === "number" && bounds) layout.set(nodeIndex, bounds);
    }

    const clickable = new Set(dom.isClickable?.index ?? []);
    const inputValues = rareStringMap(dom.inputValue);
    const text = descendantText(input.snapshot.strings, dom.nodeType, dom.nodeValue, dom.parentIndex);

    for (let i = 0; i < dom.nodeType.length && nodes.length < MAX_NODES; i += 1) {
      if (dom.nodeType[i] !== 1) continue;
      const backendNodeId = dom.backendNodeId[i];
      if (!backendNodeId) continue;

      const tag = stringAt(input.snapshot.strings, dom.nodeName[i]).toLowerCase();
      const attrs = attrsFor(input.snapshot.strings, dom.attributes[i]);
      const axNode = ax.get(backendNodeId);
      const role = inferRole(tag, attrs, axNode);
      const isClickable = clickable.has(i);
      if (!isInteractive(tag, role, attrs, isClickable)) continue;

      const bounds = layout.get(i);
      const visible = Boolean(bounds && bounds[2]! > 0 && bounds[3]! > 0 && attrs.hidden === undefined && attrs["aria-hidden"] !== "true");
      if (!visible) continue;

      const disabled = attrs.disabled !== undefined || attrs["aria-disabled"] === "true" || axNode?.disabled === true;
      const nodeText = (text[i] ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_NODE_TEXT);
      const valueIndex = inputValues.get(i);
      const value = valueIndex === undefined ? attrs.value : stringAt(input.snapshot.strings, valueIndex);
      const href = absoluteHref(attrs.href, input.url);

      nodes.push({
        id: `b${backendNodeId}`,
        role,
        name: semanticName(attrs, axNode, nodeText),
        tag,
        text: nodeText,
        ...(value !== undefined ? { value } : {}),
        ...(href ? { href } : {}),
        disabled,
        visible,
        ...(bounds ? { bbox: { x: bounds[0]!, y: bounds[1]!, width: bounds[2]!, height: bounds[3]! } } : {}),
        actions: actionsFor(tag, role, attrs, disabled, isClickable)
      });
    }
  }

  const accessibilitySummary = [...ax.values()].slice(0, 120).map(item => ({
    role: item.role ?? "",
    name: item.name ?? "",
    ...(item.disabled ? { disabled: true } : {})
  }));

  return {
    url: input.url,
    title: input.title,
    timestamp: input.timestamp ?? new Date().toISOString(),
    nodes,
    textPreview: (input.textPreview ?? "").slice(0, MAX_TEXT_PREVIEW),
    accessibilitySummary
  };
}

export async function captureSemanticPageGraph(page: Page, cdp: CDPSession): Promise<PageObservation> {
  const [snapshot, axTree, title, bodyText] = await Promise.all([
    cdp.send("DOMSnapshot.captureSnapshot", { computedStyles: [], includePaintOrder: true, includeDOMRects: true }),
    cdp.send("Accessibility.getFullAXTree").catch(() => ({ nodes: [] })),
    page.title(),
    page.locator("body").innerText({ timeout: 2500 }).catch(() => "")
  ]);

  return buildSemanticPageGraph({
    snapshot: snapshot as unknown as SnapshotLike,
    axTree: axTree as unknown as AxTreeLike,
    url: page.url(),
    title,
    textPreview: bodyText.replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_TEXT_PREVIEW)
  });
}
