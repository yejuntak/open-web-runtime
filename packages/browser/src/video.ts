import { createHash } from "node:crypto";
import type { ElementHandle, Page } from "playwright-core";

export type CaptionCue = { start: number; end: number; text: string; language: string };
export type VideoInfo = {
  id: string; frameUrl: string; label: string; visible: boolean;
  duration: number | null; currentTime: number; paused: boolean; muted: boolean;
  width: number; height: number; readyState: number; live: boolean; encrypted: boolean;
  seekable: Array<{ start: number; end: number }>;
  tracks: Array<{ language: string; label: string; kind: string; mode: string; cueCount: number }>;
  error: { code: number; message: string } | null;
};
export type VideoFrameEvidence = {
  requestedTime: number; actualTime: number; capturedAt: string;
  sha256: string; mimeType: "image/jpeg"; data: Uint8Array;
  timing: "decoded-frame" | "seek-ready"; captions: CaptionCue[];
};
export type VideoEvidence = {
  schemaVersion: "owr.video.v1"; video: VideoInfo;
  mode: "sampled-frames"; audioAnalyzed: false;
  requestedTimes: number[]; frames: VideoFrameEvidence[];
  failures: Array<{ requestedTime: number; code: string; message: string }>;
  warnings: string[]; restored: boolean;
};

export class VideoError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "VideoError"; }
}

// Keep watch-page identity but never return signed media URLs or cookies.
function pageLocation(value: string): string {
  try {
    const u = new URL(value); u.username = ""; u.password = ""; u.hash = "";
    const videoId = /(^|\.)youtube\.com$/i.test(u.hostname) ? u.searchParams.get("v") : null;
    u.search = ""; if (videoId) u.searchParams.set("v", videoId);
    return u.toString();
  } catch { return "[unavailable]"; }
}

export function validateTimestamps(times: number[]): void {
  if (!Array.isArray(times) || times.length < 1 || times.length > 8 ||
      times.some(t => typeof t !== "number" || !Number.isFinite(t) || t < 0) ||
      new Set(times).size !== times.length) {
    throw new VideoError("invalid_timestamps", "Provide 1–8 distinct, finite, nonnegative timestamps in seconds.");
  }
}

/** Inspect media already accessible in the authorized browser session.
 * No downloads, DRM circumvention, cookie export, or second LLM are used.
 * IDs are scoped to this inspector and invalidated by the next list call.
 */
export class VideoInspector {
  private handles = new Map<string, ElementHandle<HTMLVideoElement>>();
  private generation = 0;
  constructor(private page: Page) {}

  async dispose(): Promise<void> {
    await Promise.all([...this.handles.values()].map(h => h.dispose().catch(() => undefined)));
    this.handles.clear();
  }

  async list(): Promise<{ pageUrl: string; status: "available" | "no_video"; videos: VideoInfo[]; warnings: string[] }> {
    await this.dispose(); this.generation++;
    const videos: VideoInfo[] = [];
    const warnings: string[] = [];
    for (const frame of this.page.frames().slice(0, 30)) {
      try {
        // Playwright locators pierce open shadow roots. Each frame is visited separately.
        const count = Math.min(await frame.locator("video").count(), 20 - videos.length);
        for (let i = 0; i < count; i++) {
          const raw = await frame.locator("video").nth(i).elementHandle({ timeout: 1000 });
          if (!raw) continue;
          const h = raw as ElementHandle<HTMLVideoElement>;
          const id = `v${this.generation}_${videos.length + 1}`;
          this.handles.set(id, h);
          try { videos.push(await this.info(id)); }
          catch { this.handles.delete(id); await h.dispose(); }
        }
      } catch { warnings.push("A detached or inaccessible frame could not be inspected."); }
      if (videos.length >= 20) { warnings.push("Video discovery is capped at 20 players."); break; }
    }
    if (!videos.length) warnings.push("No HTML video player is exposed. Login, consent, an unloaded player, or a non-HTML renderer may be involved; no cause is assumed.");
    return { pageUrl: pageLocation(this.page.url()), status: videos.length ? "available" : "no_video", videos, warnings };
  }

  private async target(id: string): Promise<ElementHandle<HTMLVideoElement>> {
    const h = this.handles.get(id);
    if (!h || !await h.evaluate(v => v.isConnected).catch(() => false)) {
      throw new VideoError("stale_video", "Video is missing or replaced. Call video_list again and use a returned ID.");
    }
    return h;
  }

  async info(id: string): Promise<VideoInfo> {
    const h = await this.target(id);
    const state = await h.evaluate(v => {
      const r = v.getBoundingClientRect();
      const style = getComputedStyle(v);
      return {
        frameUrl: location.href,
        label: v.getAttribute("aria-label") || v.title || "HTML video",
        visible: r.width > 0 && r.height > 0 && style.visibility !== "hidden" && style.display !== "none",
        duration: Number.isFinite(v.duration) ? v.duration : null,
        currentTime: v.currentTime, paused: v.paused, muted: v.muted,
        width: v.videoWidth, height: v.videoHeight, readyState: v.readyState,
        live: v.duration === Infinity, encrypted: Boolean(v.mediaKeys),
        seekable: Array.from({ length: v.seekable.length }, (_, i) => ({ start: v.seekable.start(i), end: v.seekable.end(i) })),
        tracks: Array.from(v.textTracks).map(t => ({ language: t.language, label: t.label, kind: t.kind, mode: t.mode, cueCount: t.cues?.length ?? 0 })),
        error: v.error ? { code: v.error.code, message: v.error.message.slice(0, 300) } : null
      };
    });
    return { ...state, id, frameUrl: pageLocation(state.frameUrl) };
  }

  async captions(id: string, start = 0, end = 86400): Promise<{
    status: "available" | "not_exposed" | "empty_range";
    source: "browser_text_tracks"; audioAnalyzed: false; cues: CaptionCue[]; truncated: boolean;
  }> {
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
      throw new VideoError("invalid_range", "Caption range must be finite, with 0 <= start < end.");
    }
    const h = await this.target(id);
    const result = await h.evaluate(async (v, range) => {
      const tracks = Array.from(v.textTracks).filter(t => t.kind === "subtitles" || t.kind === "captions");
      const modes = tracks.map(t => t.mode);
      try {
        tracks.forEach(t => { if (t.mode === "disabled") t.mode = "hidden"; });
        // Exposed tracks may need a brief load. Do not fetch private caption endpoints.
        const deadline = performance.now() + 1000;
        while (tracks.length && tracks.every(t => !t.cues?.length) && performance.now() < deadline) {
          await new Promise(r => setTimeout(r, 50));
        }
        const cues: CaptionCue[] = [];
        let matched = 0;
        for (const t of tracks) {
          const available = t.cues;
          for (let i = 0; available && i < Math.min(available.length, 10000); i++) {
            const c = available[i] as VTTCue;
            if (c.endTime <= range.start || c.startTime >= range.end) continue;
            matched++;
            if (cues.length < 200) cues.push({ start: c.startTime, end: c.endTime, text: String(c.text ?? "").slice(0, 2000), language: t.language });
          }
        }
        return { exposed: tracks.some(t => Boolean(t.cues?.length)), cues, truncated: matched > 200 || tracks.some(t => (t.cues?.length ?? 0) > 10000) };
      } finally { tracks.forEach((t, i) => { t.mode = modes[i]!; }); }
    }, { start, end });
    return { status: result.cues.length ? "available" : result.exposed ? "empty_range" : "not_exposed", source: "browser_text_tracks", audioAnalyzed: false, cues: result.cues, truncated: result.truncated };
  }

  private async seek(h: ElementHandle<HTMLVideoElement>, time: number, timeoutMs: number): Promise<{ actualTime: number; timing: "decoded-frame" | "seek-ready" }> {
    const result = await h.evaluate(async (v, options) => {
      v.pause();
      if (!v.isConnected) throw new Error("stale_video");
      if (v.mediaKeys) throw new Error("protected_media");
      let decoded = false;
      let callback: number | undefined;
      if (typeof v.requestVideoFrameCallback === "function") callback = v.requestVideoFrameCallback(() => { decoded = true; });
      try {
        v.currentTime = options.time;
        const deadline = performance.now() + options.timeoutMs;
        while (performance.now() < deadline) {
          if (!v.isConnected) throw new Error("stale_video");
          if (v.error) throw new Error("media_error");
          if (!v.seeking && v.readyState >= 2 && Math.abs(v.currentTime - options.time) < 0.25) {
            // Give the compositor a chance to render after a seek, even on paused media.
            await new Promise(r => setTimeout(r, 100));
            return { actualTime: v.currentTime, timing: decoded ? "decoded-frame" as const : "seek-ready" as const };
          }
          await new Promise(r => setTimeout(r, 30));
        }
        throw new Error("seek_timeout");
      } finally { if (callback !== undefined) v.cancelVideoFrameCallback(callback); }
    }, { time, timeoutMs });
    return result;
  }

  async sample(id: string, timestamps: number[]): Promise<VideoEvidence> {
    validateTimestamps(timestamps);
    const h = await this.target(id);
    const video = await this.info(id);
    if (video.encrypted) throw new VideoError("protected_media", "Encrypted/DRM media is not sampled.");
    if (!video.visible) throw new VideoError("hidden_video", "The player is not visible; expose it before sampling.");
    if (video.error) throw new VideoError("media_error", video.error.message || "The player reports a media error.");
    if (video.live || video.duration === null || video.duration <= 0) {
      throw new VideoError("not_seekable", "Finite, loaded on-demand media is required. Live streams and unloaded media need a different capture mode.");
    }
    if (timestamps.some(t => t >= video.duration!)) throw new VideoError("out_of_range", "A requested timestamp is outside the loaded video's duration.");
    const frames: VideoFrameEvidence[] = [];
    const failures: VideoEvidence["failures"] = [];
    const warnings = ["This is sparse visual sampling, not continuous viewing. Unsampled events and audio are not analyzed."];
    const before = await h.evaluate(v => ({ time: v.currentTime, paused: v.paused, muted: v.muted, source: v.currentSrc }));
    const deadline = Date.now() + 40000;
    let bytes = 0;
    let restored = false;
    try {
      await h.evaluate(v => { v.pause(); v.muted = true; });
      await h.scrollIntoViewIfNeeded({ timeout: 3000 });
      const captions = await this.captions(id, 0, video.duration);
      if (captions.status === "not_exposed") warnings.push("No captions are exposed through browser text tracks; speech has not been transcribed.");
      if (captions.truncated) warnings.push("Caption extraction reached its bounded cue budget.");
      for (const requestedTime of timestamps) {
        if (Date.now() >= deadline) {
          failures.push({ requestedTime, code: "time_budget", message: "Video capture time budget exhausted." }); continue;
        }
        try {
          if (await h.evaluate(v => v.currentSrc) !== before.source) throw new VideoError("source_changed", "The player switched media (for example, an ad or playlist item). Relist before sampling.");
          const state = await this.seek(h, requestedTime, Math.min(4000, Math.max(100, deadline - Date.now())));
          const data = await h.screenshot({ type: "jpeg", quality: 65, animations: "allow", timeout: Math.min(3000, Math.max(100, deadline - Date.now())) });
          const actualTime = await h.evaluate(v => v.currentTime);
          if (Math.abs(actualTime - requestedTime) >= 0.25 || await h.evaluate(v => v.currentSrc) !== before.source) throw new VideoError("unstable_media", "Player changed time or source during the capture.");
          bytes += data.byteLength;
          if (bytes > 6 * 1024 * 1024) throw new VideoError("byte_budget", "Frame batch exceeds the 6 MiB image budget.");
          frames.push({ requestedTime, actualTime, capturedAt: new Date().toISOString(), sha256: createHash("sha256").update(data).digest("hex"), mimeType: "image/jpeg", data: new Uint8Array(data), timing: state.timing, captions: captions.cues.filter(c => c.start <= actualTime && c.end > actualTime).slice(0, 10) });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ requestedTime, code: error instanceof VideoError ? error.code : /timeout/i.test(message) ? "seek_timeout" : "capture_failed", message: message.slice(0, 300) });
        }
      }
    } finally {
      try {
        if (await h.evaluate(v => v.currentSrc) !== before.source) throw new Error("source changed");
        await this.seek(h, before.time, 2000);
        await h.evaluate(async (v, state) => { v.muted = state.muted; if (!state.paused) await v.play(); }, before);
        restored = true;
      } catch { warnings.push("The original playback position/state could not be fully restored."); }
    }
    return { schemaVersion: "owr.video.v1", video, mode: "sampled-frames", audioAnalyzed: false, requestedTimes: [...timestamps], frames, failures, warnings, restored };
  }
}
