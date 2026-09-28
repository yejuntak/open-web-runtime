import type {
  ObservationDiff,
  PageObservation,
  SemanticNode,
  SemanticNodeChange,
  SemanticNodeSummary
} from "./types.js";

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 180);
}

function normalizedHref(href: string | undefined): string {
  if (!href) return "";
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return href.split(/[?#]/, 1)[0] ?? href;
  }
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function semanticKeyForNode(node: Pick<SemanticNode, "role" | "name" | "tag" | "text" | "href">): string {
  const identity = [
    normalize(node.role),
    normalize(node.tag),
    normalize(node.name || node.text),
    normalize(normalizedHref(node.href))
  ].join("|");
  return `s_${fnv1a(identity)}`;
}

function summary(node: SemanticNode): SemanticNodeSummary {
  return {
    id: node.id,
    semanticKey: node.semanticKey ?? semanticKeyForNode(node),
    role: node.role,
    name: node.name,
    tag: node.tag,
    text: node.text.slice(0, 280),
    ...(node.value !== undefined ? { value: node.value } : {}),
    ...(node.href ? { href: node.href } : {}),
    disabled: node.disabled,
    visible: node.visible,
    actions: [...node.actions]
  };
}

function keys(nodes: SemanticNode[]): Map<string, SemanticNode[]> {
  const out = new Map<string, SemanticNode[]>();
  for (const node of nodes) {
    const key = node.semanticKey ?? semanticKeyForNode(node);
    const bucket = out.get(key) ?? [];
    bucket.push(node);
    out.set(key, bucket);
  }
  return out;
}

function changedFields(before: SemanticNode, after: SemanticNode): string[] {
  const fields: string[] = [];
  if (before.name !== after.name) fields.push("name");
  if (before.text !== after.text) fields.push("text");
  if (before.value !== after.value) fields.push("value");
  if (before.href !== after.href) fields.push("href");
  if (before.disabled !== after.disabled) fields.push("disabled");
  if (before.visible !== after.visible) fields.push("visible");
  if (before.actions.join("|") !== after.actions.join("|")) fields.push("actions");
  return fields;
}

export function diffObservations(before: PageObservation, after: PageObservation): ObservationDiff {
  const beforeById = new Map(before.nodes.map(node => [node.id, node]));
  const afterById = new Map(after.nodes.map(node => [node.id, node]));
  const matchedBefore = new Set<string>();
  const matchedAfter = new Set<string>();
  const pairs: Array<[SemanticNode, SemanticNode]> = [];

  for (const [id, previous] of beforeById) {
    const current = afterById.get(id);
    if (!current) continue;
    matchedBefore.add(id);
    matchedAfter.add(id);
    pairs.push([previous, current]);
  }

  const unmatchedBefore = before.nodes.filter(node => !matchedBefore.has(node.id));
  const unmatchedAfter = after.nodes.filter(node => !matchedAfter.has(node.id));
  const beforeByKey = keys(unmatchedBefore);
  const afterByKey = keys(unmatchedAfter);

  for (const [key, previousNodes] of beforeByKey) {
    const currentNodes = afterByKey.get(key);
    if (previousNodes.length !== 1 || currentNodes?.length !== 1) continue;
    const previous = previousNodes[0]!;
    const current = currentNodes[0]!;
    matchedBefore.add(previous.id);
    matchedAfter.add(current.id);
    pairs.push([previous, current]);
  }

  const changed: SemanticNodeChange[] = [];
  let unchangedCount = 0;
  for (const [previous, current] of pairs) {
    const fields = changedFields(previous, current);
    if (fields.length === 0) {
      unchangedCount += 1;
      continue;
    }
    changed.push({
      semanticKey: current.semanticKey ?? semanticKeyForNode(current),
      beforeId: previous.id,
      afterId: current.id,
      fields,
      after: summary(current)
    });
  }

  return {
    from: { url: before.url, title: before.title },
    to: { url: after.url, title: after.title },
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    added: after.nodes.filter(node => !matchedAfter.has(node.id)).map(summary),
    removed: before.nodes.filter(node => !matchedBefore.has(node.id)).map(summary),
    changed,
    unchangedCount
  };
}
