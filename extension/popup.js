const bridge = document.querySelector('#bridge');
const token = document.querySelector('#token');
const status = document.querySelector('#status');

async function refresh() {
  const result = await chrome.runtime.sendMessage({ type: 'status' }).catch(() => null);
  status.textContent = result?.shared
    ? `Shared: ${result.title || result.url || 'current tab'}`
    : 'Nothing is shared.';
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
});
document.querySelector('#stop').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop' }).catch(() => undefined);
  await refresh();
});
refresh();