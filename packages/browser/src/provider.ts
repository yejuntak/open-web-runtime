import { chromium } from "playwright-core";
import type { BrowserProvider } from "@owr/core";
import { PlaywrightBrowserSession } from "./session.js";

export class LocalChromiumProvider implements BrowserProvider {
  constructor(private options: { executablePath?: string; headless?: boolean } = {}) {}

  async createSession() {
    const browser = await chromium.launch({
      executablePath: this.options.executablePath || undefined,
      headless: this.options.headless ?? true
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    return new PlaywrightBrowserSession("local", browser, page);
  }
}

export class RemoteCdpProvider implements BrowserProvider {
  constructor(private cdpUrl: string) {}

  async createSession() {
    if (!this.cdpUrl) throw new Error("REMOTE_CDP_URL is required");
    const browser = await chromium.connectOverCDP(this.cdpUrl);
    const context = browser.contexts()[0];
    if (!context) throw new Error("Remote browser did not expose a context");
    const page = context.pages()[0] ?? await context.newPage();
    return new PlaywrightBrowserSession("remote-cdp", browser, page);
  }
}

export function browserProviderFromEnv(env = process.env): BrowserProvider {
  if (env.REMOTE_CDP_URL) return new RemoteCdpProvider(env.REMOTE_CDP_URL);
  return new LocalChromiumProvider({
    executablePath: env.CHROME_EXECUTABLE_PATH || undefined,
    headless: env.HEADLESS !== "false"
  });
}
