// ToxiProxy actions: inject / remove toxics and refresh proxy status panel.

import { request } from "./api.js";
import { appendLog } from "./log.js";
import {
  inToxiproxyBackoff,
  setToxiproxyBackoff,
  clearToxiproxyBackoff,
  toxiproxyBackoffSecondsLeft
} from "./api.js";

const TOXIPROXY_API_PREFIX = "/internal/toxiproxy";

// ── Status refresh ────────────────────────────────────────────────────────────

export async function refreshToxiproxyStatus() {
  const view = document.getElementById("toxiproxyView");
  if (inToxiproxyBackoff()) {
    if (view) view.textContent = `访问受限，${toxiproxyBackoffSecondsLeft()}s 后重试`;
    return;
  }
  try {
    const data = await request(`${TOXIPROXY_API_PREFIX}/proxies`);
    clearToxiproxyBackoff();
    if (!data || typeof data !== "object") {
      if (view) view.textContent = "ToxiProxy 返回为空";
      return;
    }
    const lines = Object.values(data).map(proxy => {
      const toxics = (proxy.toxics || []).map(t => `${t.name}:${t.type}`).join(", ") || "none";
      return `${proxy.name} -> ${proxy.upstream} | toxics: ${toxics}`;
    });
    if (view) view.textContent = lines.length ? lines.join("\n") : "无代理";
  } catch (error) {
    if (error.httpStatus === 401 || error.httpStatus === 403) {
      setToxiproxyBackoff(60);
    }
    if (view) view.textContent = `读取失败: ${error.message}`;
    appendLog(`toxiproxy 状态读取失败: ${error.message}`, "WARN");
  }
}

// ── Toxic management ──────────────────────────────────────────────────────────

export async function removeToxic(proxyName, toxicName, silent = false) {
  await request(
    `${TOXIPROXY_API_PREFIX}/proxies/${encodeURIComponent(proxyName)}/toxics/${encodeURIComponent(toxicName)}`,
    { method: "DELETE" }
  );
  if (!silent) appendLog(`toxiproxy toxic removed @${proxyName}/${toxicName}`);
}

export async function clearAllToxics() {
  const data = await request(`${TOXIPROXY_API_PREFIX}/proxies`);
  for (const proxy of Object.values(data || {})) {
    for (const toxic of proxy.toxics || []) {
      await removeToxic(proxy.name, toxic.name, true);
    }
  }
  appendLog("toxiproxy all toxics cleared");
}

export async function injectDelay(proxyName, toxicName, latency, jitter, durationSec) {
  // Remove any existing toxic with the same name first (idempotent).
  try {
    await removeToxic(proxyName, toxicName, true);
    appendLog(`toxiproxy removed pre-existing toxic '${toxicName}' @${proxyName}`);
  } catch (e) {
    if (e.httpStatus !== 404) {
      appendLog(`toxiproxy pre-remove warn (${e.httpStatus || "?"}): ${e.message}`, "WARN");
    }
  }
  await request(`${TOXIPROXY_API_PREFIX}/proxies/${encodeURIComponent(proxyName)}/toxics`, {
    method: "POST",
    body: {
      name: toxicName,
      type: "latency",
      stream: "downstream",
      toxicity: 1.0,
      attributes: { latency, jitter }
    }
  });
  appendLog(`toxiproxy delay injected @${proxyName} (${latency}ms + jitter ${jitter}ms)`);
  if (durationSec > 0) {
    setTimeout(async () => {
      try {
        await removeToxic(proxyName, toxicName, true);
      } catch (error) {
        appendLog(`auto remove toxic failed: ${error.message}`, "WARN");
      }
    }, durationSec * 1000);
  }
}

export async function injectResetPeer(proxyName, toxicName) {
  try {
    await removeToxic(proxyName, toxicName, true);
  } catch (e) {
    if (e.httpStatus !== 404) {
      appendLog(`toxiproxy pre-remove warn (${e.httpStatus || "?"}): ${e.message}`, "WARN");
    }
  }
  await request(`${TOXIPROXY_API_PREFIX}/proxies/${encodeURIComponent(proxyName)}/toxics`, {
    method: "POST",
    body: {
      name: toxicName,
      type: "reset_peer",
      stream: "downstream",
      toxicity: 1.0,
      attributes: { timeout: 0 }
    }
  });
  appendLog(`toxiproxy reset_peer injected @${proxyName}`);
}
