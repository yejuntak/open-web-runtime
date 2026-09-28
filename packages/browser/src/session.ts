import type { Browser, CDPSession, Page } from "playwright-core";
import type { AgentAction, BrowserFrame, BrowserSession, PageObservation, SemanticNode } from "@owr/core";
import { captureSemanticPageGraph } from "./semantic.js";

export class PlaywrightBrowserSession implements BrowserSession {
  private cdp?: CDPSession;
  private lastObservation?: PageObservation;

  constructor(
    readonly backend: string,
    private browser: Browser,
    private page: Page,
    readonly debugUrl?: string
  ) {}

  private async protocol(): Promise<CDPSession> {
    if (!this.cdp) this.cdp = await this.page.context().newCDPSession(this.page);
    return this.cdp;
  }

  async observe(): Promise<PageObservation> {
    this.lastObservation = await captureSemanticPageGraph(this.page, await this.protocol());
    return this.lastObservation;
  }

  async screenshot(): Promise<BrowserFrame> {
    const data = await this.page.screenshot({
      type: "jpeg",
      quality: 72,
      fullPage: false,
      animations: "disabled",
      caret: "hide"
    });
    return {
      data: new Uint8Array(data),
      mimeType: "image/jpeg",
      capturedAt: new Date().toISOString(),
      url: this.page.url()
    };
  }

  async subscribeFrames(listener: (frame: BrowserFrame) => void): Promise<() => Promise<void>> {
    const cdp = await this.protocol();
    let active = true;
    const handler = (event: { data: string; sessionId: number }) => {
      if (active) {
        listener({
          data: new Uint8Array(Buffer.from(event.data, "base64")),
          mimeType: "image/jpeg",
          capturedAt: new Date().toISOString(),
          url: this.page.url()
        });
      }
      void cdp.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined);
    };

    cdp.on("Page.screencastFrame", handler);
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 58,
      maxWidth: 1600,
      maxHeight: 900,
      everyNthFrame: 2
    });

    return async () => {
      active = false;
      cdp.off("Page.screencastFrame", handler);
      await cdp.send("Page.stopScreencast").catch(() => undefined);
    };
  }

  async extractDocument() {
    const [title, text, description, canonicalHref, rawLinks] = await Promise.all([
      this.page.title(),
      this.page.locator("body").innerText({ timeout: 5000 }).catch(() => ""),
      this.page.locator('meta[name="description"]').first().getAttribute("content").catch(() => null),
      this.page.locator('link[rel="canonical"]').first().getAttribute("href").catch(() => null),
      this.page.locator("a[href]").evaluateAll(elements =>
        elements.slice(0, 500).map(element => ({
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
          href: element.getAttribute("href") ?? ""
        }))
      ).catch(() => [])
    ]);

    const baseUrl = this.page.url();
    const links = rawLinks.flatMap(link => {
      if (!link.href) return [];
      try {
        return [{ text: link.text, href: new URL(link.href, baseUrl).toString() }];
      } catch {
        return [];
      }
    });

    let canonicalUrl: string | undefined;
    if (canonicalHref) {
      try { canonicalUrl = new URL(canonicalHref, baseUrl).toString(); } catch { canonicalUrl = undefined; }
    }

    return {
      url: baseUrl,
      title,
      text: text.replace(/\n{3,}/g, "\n\n").trim(),
      links,
      fetchedAt: new Date().toISOString(),
      ...(description ? { description } : {}),
      ...(canonicalUrl ? { canonicalUrl } : {})
    };
  }

  private node(nodeId: string): SemanticNode {
    const node = this.lastObservation?.nodes.find(candidate => candidate.id === nodeId);
    if (!node) throw new Error(`Semantic node ${nodeId} is not present in the latest observation`);
    if (!node.visible) throw new Error(`Semantic node ${nodeId} is not visible`);
    if (node.disabled) throw new Error(`Semantic node ${nodeId} is disabled`);
    return node;
  }

  private async point(node: SemanticNode): Promise<{ x: number; y: number }> {
    if (!node.bbox) throw new Error(`Semantic node ${node.id} has no layout box`);
    return {
      x: node.bbox.x + node.bbox.width / 2,
      y: node.bbox.y + node.bbox.height / 2
    };
  }

  async execute(action: AgentAction): Promise<void> {
    switch (action.type) {
      case "navigate":
        await this.page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        this.lastObservation = undefined;
        return;

      case "click": {
        const node = this.node(action.nodeId);
        if (!node.actions.includes("click")) throw new Error(`Node ${node.id} does not advertise click`);
        const p = await this.point(node);
        await this.page.mouse.click(p.x, p.y);
        this.lastObservation = undefined;
        return;
      }

      case "type": {
        const node = this.node(action.nodeId);
        if (!node.actions.includes("type")) throw new Error(`Node ${node.id} does not advertise text input`);
        const p = await this.point(node);
        await this.page.mouse.click(p.x, p.y);
        await this.page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A").catch(() => undefined);
        await this.page.keyboard.insertText(action.text);
        if (action.submit) await this.page.keyboard.press("Enter");
        this.lastObservation = undefined;
        return;
      }

      case "select": {
        const node = this.node(action.nodeId);
        if (!node.actions.includes("select")) throw new Error(`Node ${node.id} does not advertise selection`);
        if (!node.name) throw new Error(`Node ${node.id} has no accessible name for select resolution`);
        const locator = this.page.getByRole("combobox", { name: node.name, exact: true });
        if (await locator.count() !== 1) throw new Error(`Could not uniquely resolve select node ${node.id}`);
        await locator.selectOption(action.value);
        this.lastObservation = undefined;
        return;
      }

      case "press":
        await this.page.keyboard.press(action.key);
        this.lastObservation = undefined;
        return;

      case "scroll":
        await this.page.mouse.wheel(0, action.direction === "down" ? action.amount : -action.amount);
        this.lastObservation = undefined;
        return;

      case "wait":
        await this.page.waitForTimeout(action.ms);
        return;

      case "complete":
        return;
    }
  }

  async close(): Promise<void> {
    await this.cdp?.detach().catch(() => undefined);
    await this.browser.close().catch(() => undefined);
  }
}
