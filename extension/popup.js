const bridge = document.querySelector('#bridge');
const token = document.querySelector('#token');
const status = document.querySelector('#status');
const audioStatus = document.querySelector('#audioStatus');

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  status.textContent = result?.shared
    ? `Shared: ${result.title || result.url || 'current tab'}`
    : 'Nothing is shared.';
  audioStatus.textContent = result?.audioEnabled ? 'Audio capture is enabled for the shared tab.' : 'Audio capture is off.';
}
document.querySelector('#share').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return status.textContent = 'No active tab.';
  const result = await chrome.runtime.sendMessage({
    type: 'share',
    tabId: tab.id,
    bridgeUrl: bridge.value.trim(),
    token: token.value
  }).catch(error => ({ ok: false, error: String(error) }));
  status.textContent = result?.ok ? 'Paired. Keep this browser running.' : (result?.error || 'Pairing failed.');
  token.value = '';
  await refresh();
});
document.querySelector('#stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop' }).catch(() => undefined);
  await refresh();
});
document.querySelector('#enableAudio').addEventListener('click', async () => {
  const state = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  if (!state?.shared || !state.tabId) {
    audioStatus.textContent = 'Share the intended video tab first.';
    return;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!active?.id || active.id !== state.tabId) {
    audioStatus.textContent = 'Bring the already-shared tab to the foreground, then try again.';
    return;
  }
  const granted = await chrome.permissions.request({ permissions: ['tabCapture', 'offscreen'] }).catch(() => false);
  if (!granted) {
    audioStatus.textContent = 'Audio permission was not granted.';
    return;
  }
  try {
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: state.tabId });
    const result = await chrome.runtime.sendMessage({ type: 'enableAudio', tabId: state.tabId, streamId });
    audioStatus.textContent = result?.ok ? 'Audio capture enabled. The tab should remain audible.' : (result?.error || 'Audio setup failed.');
  } catch (error) {
    audioStatus.textContent = error instanceof Error ? error.message : String(error);
  }
  await refresh();
});
document.querySelector('#disableAudio').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'disableAudio' }).catch(() => undefined);
  await refresh();
});
refresh();