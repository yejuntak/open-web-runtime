import { navigationPolicy } from "./policy.js";
import type { BrowserProvider, WebDocument } from "./types.js";

export type WebFetcherOptions = {
  allowPrivateNetworks?: boolean;
  defaultMaxTextChars?: number;
};

export class WebFetcher {
  constructor(
    readonly browserProvider: BrowserProvider,
    readonly options: WebFetcherOptions = {}
  ) {}

  async fetch(input: { url: string; settleMs?: number; maxTextChars?: number }): Promise<WebDocument> {
    const policy = navigationPolicy(input.url, this.options.allowPrivateNetworks);
    if (policy.kind === "deny") throw new Error(policy.reason);

    const settleMs = input.settleMs ?? 300;
    if (!Number.isInteger(settleMs) || settleMs < 0 || settleMs > 5000) {
      throw new Error("settleMs must be an integer between 0 and 5000");
    }

    const maxTextChars = input.maxTextChars ?? this.options.defaultMaxTextChars ?? 200_000;
    if (!Number.isInteger(maxTextChars) || maxTextChars < 1_000 || maxTextChars > 2_000_000) {
      throw new Error("maxTextChars must be an integer between 1000 and 2000000");
    }

    const browser = await this.browserProvider.createSession();
    try {
      if (!browser.extractDocument) throw new Error("Browser provider does not support document extraction");
      await browser.execute({ type: "navigate", url: input.url });
      if (settleMs > 0) await browser.execute({ type: "wait", ms: settleMs });
      const document = await browser.extractDocument();
      return {
        ...document,
        text: document.text.slice(0, maxTextChars),
        links: document.links.slice(0, 500)
      };
    } finally {
      await browser.close().catch(() => undefined);
    }
  }
}
