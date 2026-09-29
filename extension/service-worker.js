let socket;
let sharedTabId;
let sharedUrl;
let keepAliveTimer;
let generation = 0;

function normalizeBridgeUrl(input) {
  const u = new URL(input);
  if (u.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(u.hostname) || !u.port || u.username || u.password) {
    throw new Error('Bridge must be an explicit local ws://127.0.0.1:PORT or ws://localhost:PORT endpoint.');
  }
  if (u.pathname !== '/bridge') throw new Error('Bridge path must be /bridge.');
  return u.toString();
}

function identity(input) {
  const u = new URL(input);
  const host = u.hostname.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? u.pathname.split('/')[1] :
      u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(shorts|embed|live)\/([^/]+)\/?$/.exec(u.pathname)?.[2];
    if (!id || !/^[\w-]{11}$/.test(id)) throw new Error('Expected a specific YouTube video.');
    return 'youtube:' + id;
  }
  if (host === 'instagram.com') {
    const match = /^\/(reel|reels|p|tv)\/([\w-]+)\/?$/.exec(u.pathname);
    if (!match) throw new Error('Expected an Instagram reel or post permalink.');
    return 'instagram:' + match[2];
  }
  if (host === 'x.com' || host === 'twitter.com') {
    const match = /^\/(?:[^/]+\/status|i\/web\/status)\/(\d+)(?:\/video\/\d+)?\/?$/.exec(u.pathname);
    if (!match) throw new Error('Expected an X/Twitter status permalink.');
    return 'x:' + match[1];
  }
  throw new Error('Only Instagram, YouTube and X/Twitter video permalinks are shareable.');
}

function visibleVideoSummary() {
  const roots = [document];
  const videos = [];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const v of root.querySelectorAll('video')) {
      const rect = v.getBoundingClientRect();
      const style = getComputedStyle(v);
      const visible = rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
      videos.push({
        index: videos.length,
        label: v.getAttribute('aria-label') || v.getAttribute('title') || v.getAttribute('data-testid') || 'HTML video',
        visible,
        duration: Number.isFinite(v.duration) ? v.duration : null,
        currentTime: Number.isFinite(v.currentTime) ? v.currentTime : 0,
        paused: v.paused,
        muted: v.muted,
        readyState: v.readyState,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        live: !Number.isFinite(v.duration) || v.duration === Infinity,
        encrypted: Boolean(v.mediaKeys)
      });
    }
  }
  return videos;
}

function prepareVideo(playerLabel, captureId) {
  const roots = [document];
  const videos = [];
  for (let i = 0; i < roots.length; i++) {
    const root = roots[i];
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    for (const v of root.querySelectorAll('video')) {
      const rect = v.getBoundingClientRect();
      const style = getComputedStyle(v);
      const visible = rect.width > 8 && rect.height > 8 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0;
      const label = v.getAttribute('aria-label') || v.getAttribute('title') || v.getAttribute('data-testid') || 'HTML video';
      if (visible && v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0 && !v.mediaKeys && (!playerLabel || label === playerLabel)) {
        videos.push({ v, label });
      }
    }
  }
  if (videos.length !== 1) return { ok: false, error: `Expected exactly one loaded visible on-demand HTML video; found ${videos.length}.` };
  const { v, label } = videos[0];
  v.setAttribute('data-owr-shared-capture', captureId);
  globalThis.__owrSharedStates ||= {};
  globalThis.__owrSharedStates[captureId] = {
    currentTime: v.currentTime, paused: v.paused, muted: v.muted, playbackRate: v.playbackRate
  };
  return { ok: true, label, duration: v.duration, readyState: v.readyState, currentTime: v.currentTime };
}

async function seekVideo(captureId, target) {
  const v = document.querySelector(`video[data-owr-shared-capture="${CSS.escape(captureId)}"]`);
  if (!v) return { ok: false, error: 'Selected video was replaced or removed.' };
  if (!(target >= 0 && Number.isFinite(target) && target < v.duration)) return { ok: false, error: 'Timestamp is outside the loaded duration.' };
  v.pause();
  if (Math.abs(v.currentTime - target) > 0.04) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Seek timed out.')), 8000);
      v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
      v.currentTime = target;
    }).catch(error => ({ __error: error.message }));
  }
  if ('requestVideoFrameCallback' in v) {
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 500);
      v.requestVideoFrameCallback(() => { clearTimeout(timer); resolve(); });
    });
  } else {
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  const cues = [];
  for (const track of Array.from(v.textTracks || [])) {
    const active = Array.from(track.activeCues || []);
    for (const cue of active) cues.push({
      startTime: cue.startTime, endTime: cue.endTime, text: String(cue.text || '').slice(0, 1000),
      language: track.language || '', label: track.label || ''
    });
  }
  return { ok: true, actualTime: v.currentTime, cues };
}

async function restoreVideo(captureId) {
  const v = document.querySelector(`video[data-owr-shared-capture="${CSS.escape(captureId)}"]`);
  const state = globalThis.__owrSharedStates?.[captureId];
  if (!v || !state) return false;
  try {
    v.muted = state.muted;
    v.playbackRate = state.playbackRate;
    v.currentTime = Math.min(state.currentTime, Math.max(0, v.duration - 0.01));
    await new Promise(resolve => {
      if (!v.seeking) return resolve();
      const timer = setTimeout(resolve, 1200);
      v.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    if (!state.paused) await v.play().catch(() => undefined); else v.pause();
    return true;
  } finally {
    v.removeAttribute('data-owr-shared-capture');
    delete globalThis.__owrSharedStates[captureId];
  }
}

async function runScript(frameId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId: sharedTabId, frameIds: [frameId] },
    world: 'MAIN',
    func,
    args
  });
  return results[0]?.result;
}

async function discoverAllFrames() {
  const results = await chrome.scripting.executeScript({
    target: { tabId: sharedTabId, allFrames: true },
    world: 'MAIN',
    func: visibleVideoSummary
  });
  return results.flatMap(item => (item.result || []).map(video => ({ frameId: item.frameId, ...video })));
}

async function withFocusedTab(operation) {
  const tab = await chrome.tabs.get(sharedTabId);
  if (!tab?.windowId) throw new Error('Shared tab is gone.');
  const [before] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
  await chrome.tabs.update(sharedTabId, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  try {
    return await operation(tab);
  } finally {
    if (before?.id && before.id !== sharedTabId) await chrome.tabs.update(before.id, { active: true }).catch(() => undefined);
  }
}

async function captureJpeg(windowId) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'jpeg', quality: 82 });
  const marker = 'base64,';
  const index = dataUrl.indexOf(marker);
  if (index < 0) throw new Error('Unexpected screenshot encoding.');
  return dataUrl.slice(index + marker.length);
}

async function inspectVideo(payload) {
  const tab = await chrome.tabs.get(sharedTabId);
  if (identity(tab.url) !== identity(payload.url)) throw new Error('The shared tab is no longer the requested video. Re-share the intended tab.');
  const timestamps = payload.timestamps;
  if (!Array.isArray(timestamps) || timestamps.length < 1 || timestamps.length > 8 || timestamps.some(t => !Number.isFinite(t) || t < 0)) {
    throw new Error('timestamps must contain 1-8 nonnegative seconds.');
  }
  return withFocusedTab(async currentTab => {
    const catalog = await discoverAllFrames();
    const candidates = catalog.filter(v => v.visible && v.readyState >= 2 && !v.live && !v.encrypted && Number.isFinite(v.duration) && v.duration > 0 &&
      (!payload.playerLabel || v.label === payload.playerLabel));
    if (candidates.length !== 1) throw new Error(`Expected one accessible HTML video; found ${candidates.length}. Try burst mode if the visible player is not DOM-accessible.`);
    const selected = candidates[0];
    if (timestamps.some(t => t >= selected.duration)) throw new Error(`All timestamps must be below ${selected.duration} seconds.`);
    const captureId = crypto.randomUUID();
    const prepared = await runScript(selected.frameId, prepareVideo, [payload.playerLabel, captureId]);
    if (!prepared?.ok) throw new Error(prepared?.error || 'Could not prepare video.');
    const images = [];
    const samples = [];
    let restored = false;
    try {
      for (const timestamp of timestamps) {
        const sample = await runScript(selected.frameId, seekVideo, [captureId, timestamp]);
        if (!sample?.ok) throw new Error(sample?.error || 'Seek failed.');
        images.push({ mimeType: 'image/jpeg', data: await captureJpeg(currentTab.windowId) });
        samples.push({ requestedTime: timestamp, actualTime: sample.actualTime, cues: sample.cues || [] });
      }
    } finally {
      restored = Boolean(await runScript(selected.frameId, restoreVideo, [captureId]).catch(() => false));
    }
    return {
      report: {
        schemaVersion: 'owr.shared-tab-video.v1',
        status: images.length === timestamps.length && restored ? 'passed' : images.length ? 'partial' : 'failed',
        url: payload.url,
        samples,
        player: { label: selected.label, duration: selected.duration, frameId: selected.frameId },
        playbackRestored: restored,
        cookiesExported: false,
        audioAnalyzed: false,
        captureMode: 'authorized-active-tab'
      },
      images
    };
  });
}

async function snapshotSharedTab() {
  return withFocusedTab(async tab => ({
    report: { schemaVersion: 'owr.shared-tab-snapshot.v1', url: tab.url, title: tab.title || '', capturedAt: new Date().toISOString() },
    images: [{ mimeType: 'image/jpeg', data: await captureJpeg(tab.windowId) }]
  }));
}

async function burstSharedTab(payload) {
  const count = Math.max(2, Math.min(8, Number(payload.count || 4)));
  const intervalMs = Math.max(200, Math.min(3000, Number(payload.intervalMs || 750)));
  return withFocusedTab(async tab => {
    const images = [];
    const frames = [];
    const started = performance.now();
    for (let i = 0; i < count; i++) {
      if (i) await new Promise(resolve => setTimeout(resolve, intervalMs));
      images.push({ mimeType: 'image/jpeg', data: await captureJpeg(tab.windowId) });
      frames.push({ index: i, elapsedMs: Math.round(performance.now() - started) });
    }
    return {
      report: {
        schemaVersion: 'owr.shared-tab-burst.v1', url: tab.url, title: tab.title || '', frames,
        captureMode: 'visible-tab-burst', audioAnalyzed: false
      },
      images
    };
  });
}

async function handleCommand(message) {
  if (!sharedTabId) throw new Error('No tab is currently shared.');
  if (message.command === 'status') {
    const tab = await chrome.tabs.get(sharedTabId);
    return { shared: true, tabId: sharedTabId, url: tab.url, title: tab.title || '' };
  }
  if (message.command === 'inspect_video') return inspectVideo(message.payload || {});
  if (message.command === 'snapshot') return snapshotSharedTab();
  if (message.command === 'burst') return burstSharedTab(message.payload || {});
  throw new Error('Unknown command.');
}

function stopSharing() {
  generation++;
  clearInterval(keepAliveTimer);
  keepAliveTimer = undefined;
  if (socket) {
    try { socket.close(); } catch {}
  }
  socket = undefined;
  sharedTabId = undefined;
  sharedUrl = undefined;
}

async function share({ tabId, bridgeUrl, token }) {
  stopSharing();
  const localGeneration = generation;
  const url = normalizeBridgeUrl(bridgeUrl);
  const tab = await chrome.tabs.get(tabId);
  identity(tab.url);
  sharedTabId = tabId;
  sharedUrl = tab.url;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    socket = ws;
    const timeout = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('Bridge connection timed out.')); }, 5000);
    ws.onopen = () => {
      clearTimeout(timeout);
      if (localGeneration !== generation) return;
      ws.send(JSON.stringify({ type: 'hello', token, tabId, url: tab.url, title: tab.title || '', extensionVersion: chrome.runtime.getManifest().version }));
      keepAliveTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping', at: Date.now() }));
      }, 20000);
      resolve({ ok: true });
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('Could not connect to the local OWR bridge.')); };
    ws.onclose = () => {
      if (socket === ws) stopSharing();
    };
    ws.onmessage = async event => {
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      if (message.type !== 'command' || !message.id) return;
      try {
        const result = await handleCommand(message);
        ws.send(JSON.stringify({ type: 'result', id: message.id, ok: true, result }));
      } catch (error) {
        ws.send(JSON.stringify({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) }));
      }
    };
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'share') {
    share(message).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'stop') {
    stopSharing();
    sendResponse({ ok: true });
    return;
  }
  if (message.type === 'status') {
    if (!sharedTabId) return sendResponse({ shared: false });
    chrome.tabs.get(sharedTabId).then(tab => sendResponse({ shared: true, url: tab.url, title: tab.title || '' }), () => sendResponse({ shared: false }));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === sharedTabId && changeInfo.url && changeInfo.url !== sharedUrl) stopSharing();
});
chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === sharedTabId) stopSharing();
});
