function safeJsonString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function inspectorHtml(taskId: string): string {
  const id = safeJsonString(taskId);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Open Web Runtime Inspector</title>
<style>
:root { color-scheme: dark; --bg:#0a0a0b; --panel:#111214; --line:#24262a; --muted:#8b9098; --text:#f2f3f5; --soft:#17191c; --good:#73d89c; --warn:#f2c66d; --bad:#f08b8b; }
* { box-sizing:border-box; }
body { margin:0; background:var(--bg); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
button,input { font:inherit; }
header { height:58px; display:flex; align-items:center; justify-content:space-between; padding:0 20px; border-bottom:1px solid var(--line); background:rgba(10,10,11,.94); position:sticky; top:0; z-index:10; backdrop-filter:blur(12px); }
.brand { font-size:14px; font-weight:700; letter-spacing:-.01em; }
.brand span { color:var(--muted); font-weight:500; margin-left:8px; }
.status { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--muted); }
.dot { width:8px; height:8px; border-radius:50%; background:var(--muted); }
.dot.running { background:var(--good); box-shadow:0 0 0 4px rgba(115,216,156,.08); }
.dot.waiting_for_approval { background:var(--warn); }
.dot.failed,.dot.cancelled { background:var(--bad); }
.dot.completed { background:var(--good); }
main { display:grid; grid-template-columns:minmax(0,1.55fr) minmax(320px,.75fr); min-height:calc(100vh - 58px); }
.viewer { padding:18px; border-right:1px solid var(--line); display:flex; flex-direction:column; gap:12px; min-width:0; }
.browser { background:#050506; border:1px solid var(--line); border-radius:13px; overflow:hidden; min-height:480px; display:flex; flex-direction:column; box-shadow:0 24px 70px rgba(0,0,0,.25); }
.chrome { height:42px; border-bottom:1px solid var(--line); display:flex; align-items:center; gap:12px; padding:0 13px; background:#121316; }
.lights { display:flex; gap:6px; }
.lights i { display:block; width:8px; height:8px; border-radius:50%; background:#34373d; }
.address { flex:1; min-width:0; border:1px solid #25282d; border-radius:7px; background:#0c0d0f; color:#9da2aa; padding:7px 10px; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.frame { flex:1; min-height:430px; display:flex; align-items:center; justify-content:center; position:relative; background:#0c0d0f; }
.frame img { width:100%; height:100%; object-fit:contain; display:none; }
.empty { color:#656a72; font-size:13px; text-align:center; line-height:1.6; padding:32px; }
.frame-meta { display:flex; justify-content:space-between; gap:16px; color:var(--muted); font-size:11px; padding:0 2px; }
.sidebar { min-width:0; display:flex; flex-direction:column; }
.section { padding:17px 18px; border-bottom:1px solid var(--line); }
.eyebrow { color:var(--muted); text-transform:uppercase; letter-spacing:.09em; font-size:10px; margin-bottom:8px; font-weight:700; }
.goal { font-size:14px; line-height:1.45; color:#e7e9ec; word-break:break-word; }
.approval { display:none; background:rgba(242,198,109,.06); border-bottom:1px solid rgba(242,198,109,.24); padding:16px 18px; }
.approval strong { display:block; font-size:13px; margin-bottom:6px; }
.approval p { margin:0 0 12px; color:#c7b98f; font-size:12px; line-height:1.45; }
.actions { display:flex; gap:8px; }
.btn { border:1px solid var(--line); border-radius:8px; background:#17191c; color:var(--text); padding:8px 11px; cursor:pointer; font-size:12px; }
.btn:hover { background:#202328; }
.btn.primary { background:#eceef1; color:#111; border-color:#eceef1; }
.trace-wrap { flex:1; min-height:0; overflow:auto; }
.trace { list-style:none; padding:0; margin:0; }
.step { padding:13px 18px; border-bottom:1px solid #1c1e22; display:grid; grid-template-columns:26px 1fr; gap:10px; }
.step-num { width:24px; height:24px; border:1px solid var(--line); border-radius:7px; display:flex; align-items:center; justify-content:center; color:var(--muted); font-size:10px; }
.step-main { min-width:0; }
.action { font-size:12px; color:#e4e6e9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.detail { margin-top:4px; color:var(--muted); font-size:10px; display:flex; gap:8px; flex-wrap:wrap; }
.error { color:var(--bad); margin-top:5px; font-size:11px; line-height:1.4; }
.result { white-space:pre-wrap; word-break:break-word; color:#b8bdc5; font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; max-height:180px; overflow:auto; }
.auth { position:fixed; inset:0; display:none; align-items:center; justify-content:center; background:rgba(0,0,0,.72); z-index:30; backdrop-filter:blur(8px); }
.auth-card { width:min(410px,calc(100vw - 36px)); border:1px solid var(--line); background:#111214; border-radius:14px; padding:22px; }
.auth-card h2 { font-size:16px; margin:0 0 7px; }
.auth-card p { color:var(--muted); font-size:12px; line-height:1.5; margin:0 0 14px; }
.auth-row { display:flex; gap:8px; }
.auth-row input { min-width:0; flex:1; background:#090a0b; color:var(--text); border:1px solid var(--line); border-radius:8px; padding:9px 10px; }
@media (max-width:900px) { main { grid-template-columns:1fr; } .viewer { border-right:0; border-bottom:1px solid var(--line); } .browser { min-height:360px; } .frame { min-height:320px; } }
</style>
</head>
<body>
<header>
  <div class="brand">Open Web Runtime <span>Inspector</span></div>
  <div class="status"><i id="dot" class="dot"></i><span id="status">connecting</span></div>
</header>
<main>
  <section class="viewer">
    <div class="browser">
      <div class="chrome">
        <div class="lights"><i></i><i></i><i></i></div>
        <div id="address" class="address">No browser frame yet</div>
      </div>
      <div class="frame">
        <img id="frame" alt="Latest browser frame">
        <div id="empty" class="empty">Waiting for the first browser observation.<br>Frames appear here as the agent executes.</div>
      </div>
    </div>
    <div class="frame-meta"><span id="backend">browser —</span><span id="frameTime">no artifact</span></div>
  </section>
  <aside class="sidebar">
    <div class="section"><div class="eyebrow">Goal</div><div id="goal" class="goal">Loading task…</div></div>
    <div id="approval" class="approval">
      <strong>Human approval required</strong>
      <p id="approvalReason"></p>
      <div class="actions"><button class="btn primary" id="approve">Approve</button><button class="btn" id="deny">Deny</button></div>
    </div>
    <div class="section"><div class="eyebrow">Run result</div><div id="result" class="result">Pending</div></div>
    <div class="trace-wrap"><ol id="trace" class="trace"></ol></div>
  </aside>
</main>
<div id="auth" class="auth">
  <div class="auth-card">
    <h2>API token required</h2>
    <p>This runtime is protected by OWR_API_TOKEN. The token stays in this browser's local storage.</p>
    <div class="auth-row"><input id="token" type="password" autocomplete="off" placeholder="Bearer token"><button id="saveToken" class="btn primary">Connect</button></div>
  </div>
</div>
<script>
const TASK_ID = ${id};
let token = localStorage.getItem("owr-inspector-token") || "";
let currentArtifactId = "";
let currentObjectUrl = "";
let liveFrameEtag = "";
let displayingLive = false;
let lastTaskStatus = "";
let polling = false;
let framePolling = false;

function headers(extra) {
  const out = new Headers(extra || {});
  if (token) out.set("authorization", "Bearer " + token);
  return out;
}

async function api(path, options) {
  const response = await fetch(path, Object.assign({}, options || {}, { headers: headers(options && options.headers) }));
  if (response.status === 401) {
    document.getElementById("auth").style.display = "flex";
    throw new Error("Unauthorized");
  }
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + (await response.text()).slice(0,300));
  return response;
}

function actionLabel(action) {
  if (!action) return "unknown";
  if (action.type === "type") return "type " + action.nodeId + " [" + String(action.textLength !== undefined ? action.textLength : String(action.text || "").length) + " chars]" + (action.submit ? " + submit" : "");
  if (action.type === "click") return "click " + action.nodeId;
  if (action.type === "select") return "select " + action.nodeId + (action.valueLength !== undefined ? " [" + action.valueLength + " chars]" : "");
  if (action.type === "navigate") {
    try { return "navigate " + new URL(action.url).origin; } catch { return "navigate"; }
  }
  if (action.type === "scroll") return "scroll " + action.direction + " " + action.amount;
  if (action.type === "wait") return "wait " + action.ms + "ms";
  if (action.type === "press") return "press " + action.key;
  return action.type;
}

function renderTask(task) {
  const status = task.status || "unknown";
  lastTaskStatus = status;
  document.getElementById("status").textContent = status.replaceAll("_"," ");
  document.getElementById("dot").className = "dot " + status;
  document.getElementById("goal").textContent = task.goal || "";
  document.getElementById("backend").textContent = "browser " + ((task.browser && task.browser.backend) || "—");

  const approval = document.getElementById("approval");
  if (task.approval) {
    approval.style.display = "block";
    document.getElementById("approvalReason").textContent = task.approval.reason + " Action: " + actionLabel(task.approval.action);
  } else {
    approval.style.display = "none";
  }

  const result = task.result !== undefined ? task.result : (task.error ? { error: task.error } : "Pending");
  document.getElementById("result").textContent = typeof result === "string" ? result : JSON.stringify(result, null, 2);

  const trace = document.getElementById("trace");
  trace.replaceChildren();
  (task.steps || []).slice().reverse().forEach(function(step) {
    const li = document.createElement("li");
    li.className = "step";
    const num = document.createElement("div");
    num.className = "step-num";
    num.textContent = String(step.step);
    const main = document.createElement("div");
    main.className = "step-main";
    const action = document.createElement("div");
    action.className = "action";
    action.textContent = actionLabel(step.action);
    const detail = document.createElement("div");
    detail.className = "detail";
    const state = document.createElement("span");
    state.textContent = step.ok ? "success" : ("failed · " + ((step.failure && step.failure.code) || "unknown"));
    const duration = document.createElement("span");
    duration.textContent = String(step.durationMs) + "ms";
    const title = document.createElement("span");
    title.textContent = (step.after && step.after.title) || (step.before && step.before.title) || "";
    detail.append(state, duration, title);
    main.append(action, detail);
    if (step.error) {
      const error = document.createElement("div");
      error.className = "error";
      error.textContent = step.error;
      main.append(error);
    }
    li.append(num, main);
    trace.append(li);
  });
}

async function renderArtifact(artifact) {
  document.getElementById("address").textContent = artifact.url || artifact.title || "Browser frame";
  document.getElementById("frameTime").textContent = (artifact.label || "frame") + " · " + new Date(artifact.createdAt).toLocaleTimeString();
  if (artifact.id === currentArtifactId && !displayingLive) return;
  currentArtifactId = artifact.id;
  const response = await api("/v1/artifacts/" + encodeURIComponent(artifact.id));
  const blob = await response.blob();
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(blob);
  const img = document.getElementById("frame");
  img.src = currentObjectUrl;
  img.style.display = "block";
  document.getElementById("empty").style.display = "none";
  displayingLive = false;
}

async function pollLiveFrame() {
  if (framePolling) return;
  framePolling = true;
  try {
    const frameHeaders = {};
    if (liveFrameEtag) frameHeaders["if-none-match"] = liveFrameEtag;
    const response = await fetch("/v1/tasks/" + encodeURIComponent(TASK_ID) + "/frame", { headers: headers(frameHeaders) });

    if (response.status === 401) {
      document.getElementById("auth").style.display = "flex";
      throw new Error("Unauthorized");
    }
    if (response.status === 304) return;
    if (response.status === 404) {
      if (displayingLive && ["completed","failed","cancelled"].includes(lastTaskStatus)) {
        displayingLive = false;
        currentArtifactId = "";
      }
      return;
    }
    if (!response.ok) throw new Error("Frame HTTP " + response.status);

    liveFrameEtag = response.headers.get("etag") || liveFrameEtag;
    const capturedAt = response.headers.get("x-owr-captured-at");
    const blob = await response.blob();
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = URL.createObjectURL(blob);

    const img = document.getElementById("frame");
    img.src = currentObjectUrl;
    img.style.display = "block";
    document.getElementById("empty").style.display = "none";
    document.getElementById("frameTime").textContent = "LIVE · " + (capturedAt ? new Date(capturedAt).toLocaleTimeString() : "now");
    displayingLive = true;
  } catch (error) {
    if (String(error.message || error) !== "Unauthorized") console.debug(error);
  } finally {
    framePolling = false;
  }
}

async function poll() {
  if (polling) return;
  polling = true;
  try {
    const task = await (await api("/v1/tasks/" + encodeURIComponent(TASK_ID))).json();
    renderTask(task);
    const artifacts = await (await api("/v1/tasks/" + encodeURIComponent(TASK_ID) + "/artifacts")).json();
    if (artifacts.length && !displayingLive) await renderArtifact(artifacts[artifacts.length - 1]);
  } catch (error) {
    if (String(error.message || error) !== "Unauthorized") {
      document.getElementById("status").textContent = "connection error";
      document.getElementById("dot").className = "dot failed";
    }
  } finally {
    polling = false;
  }
}

async function resolveApproval(approved) {
  await api("/v1/tasks/" + encodeURIComponent(TASK_ID) + "/approval", {
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({ approved: approved })
  });
  await poll();
}

document.getElementById("approve").addEventListener("click", function(){ resolveApproval(true).catch(console.error); });
document.getElementById("deny").addEventListener("click", function(){ resolveApproval(false).catch(console.error); });
document.getElementById("saveToken").addEventListener("click", function(){
  token = document.getElementById("token").value.trim();
  if (token) localStorage.setItem("owr-inspector-token", token);
  else localStorage.removeItem("owr-inspector-token");
  document.getElementById("auth").style.display = "none";
  poll();
  pollLiveFrame();
});
document.getElementById("token").addEventListener("keydown", function(event){
  if (event.key === "Enter") document.getElementById("saveToken").click();
});
window.addEventListener("beforeunload", function(){ if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl); });
poll();
pollLiveFrame();
setInterval(poll, 900);
setInterval(pollLiveFrame, 350);
</script>
</body>
</html>`;
}
