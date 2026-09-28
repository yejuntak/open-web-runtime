import type { SearchProvider, SearchResult } from "@owr/core";

type SearxResult = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  engine?: unknown;
  engines?: unknown;
};

type SearxResponse = { results?: unknown };

export type SearxngSearchProviderOptions = {
  baseUrl: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class SearxngSearchProvider implements SearchProvider {
  readonly name = "searxng";
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: SearxngSearchProviderOptions) {
    const parsed = new URL(options.baseUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("SEARXNG_BASE_URL must use http or https");
    this.baseUrl = parsed.toString().replace(/\/$/, "") + "/";
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new Error("Search query must not be empty");
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("Search limit must be between 1 and 20");

    const url = new URL("search", this.baseUrl);
    url.searchParams.set("q", normalizedQuery);
    url.searchParams.set("format", "json");

    const response = await this.fetchImpl(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);

    const payload = await response.json() as SearxResponse;
    const raw = Array.isArray(payload.results) ? payload.results as SearxResult[] : [];
    const seen = new Set<string>();
    const results: SearchResult[] = [];

    for (const item of raw) {
      if (typeof item.url !== "string" || typeof item.title !== "string") continue;
      let canonical: string;
      try { canonical = new URL(item.url).toString(); } catch { continue; }
      if (seen.has(canonical)) continue;
      seen.add(canonical);

      const sources = [
        ...(typeof item.engine === "string" ? [item.engine] : []),
        ...(Array.isArray(item.engines) ? item.engines.filter((value): value is string => typeof value === "string") : [])
      ];

      results.push({
        title: item.title.trim(),
        url: canonical,
        snippet: typeof item.content === "string" ? item.content.trim() : "",
        sources: [...new Set(sources)]
      });
      if (results.length >= limit) break;
    }
    return results;
  }
}

export function searchProviderFromEnv(env = process.env): SearchProvider | undefined {
  const baseUrl = env.SEARXNG_BASE_URL?.trim();
  return baseUrl ? new SearxngSearchProvider({ baseUrl }) : undefined;
}
