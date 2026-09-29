let stream;
let audioContext;
let audioSource;
let recording;

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not encode audio.'));
    reader.onload = () => {
      const value = String(reader.result || '');
      const marker = 'base64,';
      const index = value.indexOf(marker);
      if (index < 0) return reject(new Error('Unexpected audio encoding.'));
      resolve(value.slice(index + marker.length));
    };
    reader.readAsDataURL(blob);
  });
}

async function stopCapture() {
  if (recording?.state && recording.state !== 'inactive') {
    try { recording.stop(); } catch {}
  }
  recording = undefined;
  for (const track of stream?.getTracks?.() || []) track.stop();
  stream = undefined;
  try { audioSource?.disconnect(); } catch {}
  audioSource = undefined;
  if (audioContext) {
    try { await audioContext.close(); } catch {}
  }
  audioContext = undefined;
}

async function startCapture(streamId) {
  await stopCapture();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });
  if (!stream.getAudioTracks().length) throw new Error('The shared tab exposed no audio track.');
  let playbackForwarded = false;
  try {
    audioContext = new AudioContext();
    audioSource = audioContext.createMediaStreamSource(stream);
    audioSource.connect(audioContext.destination);
    await audioContext.resume();
    playbackForwarded = audioContext.state === 'running';
  } catch {
    playbackForwarded = false;
  }
  return {
    ok: true,
    audioTracks: stream.getAudioTracks().length,
    playbackForwarded
  };
}

async function recordAudio(durationMs) {
  if (!stream?.active || !stream.getAudioTracks().some(track => track.readyState === 'live')) {
    throw new Error('Audio capture is not active. Enable audio from the extension popup again.');
  }
  if (recording && recording.state !== 'inactive') throw new Error('An audio recording is already in progress.');
  const ms = Math.max(1000, Math.min(30000, Math.round(Number(durationMs || 5000))));
  const source = new MediaStream(stream.getAudioTracks());
  const preferred = ['audio/webm;codecs=opus', 'audio/webm'].find(type => MediaRecorder.isTypeSupported(type));
  const chunks = [];
  recording = new MediaRecorder(source, preferred ? { mimeType: preferred, audioBitsPerSecond: 128000 } : { audioBitsPerSecond: 128000 });
  const recorder = recording;
  const stopped = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = event => reject(event.error || new Error('Audio recorder failed.'));
    recorder.onstop = resolve;
  });
  recorder.start(250);
  const timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, ms);
  try {
    await stopped;
  } finally {
    clearTimeout(timer);
    if (recording === recorder) recording = undefined;
  }
  const blob = new Blob(chunks, { type: recorder.mimeType || preferred || 'audio/webm' });
  if (!blob.size) throw new Error('Audio recording returned no bytes.');
  if (blob.size > 8 * 1024 * 1024) throw new Error('Audio recording exceeded the 8 MB budget.');
  return {
    ok: true,
    mimeType: blob.type || 'audio/webm',
    byteLength: blob.size,
    durationMs: ms,
    data: await toBase64(blob)
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'owr-offscreen-audio') return;
  if (message.type === 'startAudio') {
    startCapture(message.streamId).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'recordAudio') {
    recordAudio(message.durationMs).then(sendResponse, error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message.type === 'stopAudio') {
    stopCapture().then(() => sendResponse({ ok: true }), error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});