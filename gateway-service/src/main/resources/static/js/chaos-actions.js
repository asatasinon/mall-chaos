// Chaos service actions: enable/disable slow SQL, memory leak, deadlock;
// plus status refresh for all chaos dimensions.

import { state, slowSqlServices } from "./state.js";
import {
  request, chaosPath,
  inBackoff, setBackoff, clearBackoff,
  isMissingSlowSqlStatus
} from "./api.js";
import { appendLog } from "./log.js";
import {
  renderSlowCards, renderMemoryCards, renderDeadlockCards, updateTopologyState
} from "./render.js";
import { refreshToxiproxyStatus } from "./toxiproxy.js";

// ── Form helpers ──────────────────────────────────────────────────────────────

export function slowPayloadFromForm() {
  return {
    mode:        document.getElementById("slowMode").value,
    delayMs:     Number(document.getElementById("slowDelay").value),
    injectRate:  Number(document.getElementById("slowInjectRate").value),
    durationSec: Number(document.getElementById("slowDuration").value)
  };
}

// ── Slow SQL ──────────────────────────────────────────────────────────────────

export async function slowEnable(serviceId) {
  const payload = slowPayloadFromForm();
  const result = await request(chaosPath(serviceId, "/internal/chaos/slow-sql/enable"), {
    method: "POST",
    body: payload
  });
  state.slowSql[serviceId] = {
    ...(state.slowSql[serviceId] || {}),
    enabled: true,
    mode:       result?.mode      || payload.mode,
    delayMs:    result?.delayMs   || payload.delayMs,
    injectRate: payload.injectRate
  };
  appendLog(`slow-sql enabled @${serviceId} (${payload.mode}, ${payload.delayMs}ms, rate ${payload.injectRate})`);
}

export async function slowDisable(serviceId) {
  await request(chaosPath(serviceId, "/internal/chaos/slow-sql/disable"), { method: "POST" });
  state.slowSql[serviceId] = { ...(state.slowSql[serviceId] || {}), enabled: false };
  appendLog(`slow-sql disabled @${serviceId}`);
}

// ── Memory leak ───────────────────────────────────────────────────────────────

export async function memoryAction(serviceId, action) {
  const payload = {
    chunkSizeKb: Number(document.getElementById("memChunk").value),
    intervalMs:  Number(document.getElementById("memInterval").value),
    maxMb:       Number(document.getElementById("memMax").value)
  };
  if (action === "start") {
    await request(chaosPath(serviceId, "/internal/chaos/memory-leak/start"), {
      method: "POST", body: payload
    });
    appendLog(`memory-leak start @${serviceId} (${payload.chunkSizeKb}KB/${payload.intervalMs}ms/${payload.maxMb}MB)`);
  } else if (action === "stop") {
    await request(chaosPath(serviceId, "/internal/chaos/memory-leak/stop"), { method: "POST" });
    appendLog(`memory-leak stop @${serviceId}`);
  } else {
    await request(chaosPath(serviceId, "/internal/chaos/memory-leak/clear"), { method: "POST" });
    appendLog(`memory-leak clear @${serviceId}`);
  }
  await refreshMemoryStatus(serviceId);
  renderMemoryCards();
  updateTopologyState();
}

// ── Deadlock ──────────────────────────────────────────────────────────────────

export async function deadlockAction(serviceId, action) {
  if (action === "enable") {
    const payload = {
      injectRate:  Number(document.getElementById("deadlockInjectRate").value),
      durationSec: Number(document.getElementById("deadlockDuration").value)
    };
    await request(chaosPath(serviceId, "/internal/chaos/deadlock/enable"), {
      method: "POST", body: payload
    });
    appendLog(`deadlock enabled @${serviceId} (rate ${payload.injectRate}, ${payload.durationSec}s)`);
  } else if (action === "disable") {
    await request(chaosPath(serviceId, "/internal/chaos/deadlock/disable"), { method: "POST" });
    appendLog(`deadlock disabled @${serviceId}`);
  } else {
    await request(chaosPath(serviceId, "/internal/chaos/deadlock/clear"), { method: "POST" });
    appendLog(`deadlock clear @${serviceId}`);
  }
  await refreshDeadlockStatus(serviceId);
  renderDeadlockCards();
  updateTopologyState();
}

// ── Status polling ────────────────────────────────────────────────────────────

export async function refreshSlowStatus(serviceId) {
  if (inBackoff(serviceId)) return;
  try {
    const data = await request(chaosPath(serviceId, "/internal/chaos/slow-sql/status"));
    clearBackoff(serviceId);
    state.slowSql[serviceId] = {
      supported:    true,
      enabled:      !!data?.enabled,
      mode:         data?.mode,
      delayMs:      data?.delayMs,
      injectRate:   data?.injectRate,
      autoDisableAt: data?.autoDisableAt
    };
  } catch (error) {
    if (isMissingSlowSqlStatus(error)) {
      clearBackoff(serviceId);
      if (!state.slowSql[serviceId]) state.slowSql[serviceId] = { enabled: false };
      state.slowSql[serviceId].supported = false;
    } else {
      setBackoff(serviceId, 30);
      throw error;
    }
  }
}

export async function refreshMemoryStatus(serviceId) {
  if (inBackoff(serviceId)) return;
  try {
    const data = await request(chaosPath(serviceId, "/internal/chaos/memory-leak/status"));
    clearBackoff(serviceId);
    state.memory[serviceId] = {
      running:    !!data?.running,
      holdingMb:  data?.holdingMb,
      maxMb:      data?.maxMb
    };
  } catch (error) {
    setBackoff(serviceId, 30);
    appendLog(`${serviceId} memory status 失败: ${error.message}`, "WARN");
  }
}

export async function refreshDeadlockStatus(serviceId) {
  if (inBackoff(serviceId)) return;
  try {
    const data = await request(chaosPath(serviceId, "/internal/chaos/deadlock/status"));
    clearBackoff(serviceId);
    state.deadlock[serviceId] = {
      enabled:       !!data?.enabled,
      deadlockCount: data?.deadlockCount || 0,
      lastError:     data?.lastError || ""
    };
  } catch (error) {
    setBackoff(serviceId, 30);
    appendLog(`${serviceId} deadlock status 失败: ${error.message}`, "WARN");
  }
}

export async function refreshAllStatuses() {
  for (const service of slowSqlServices) {
    try {
      await refreshSlowStatus(service.id);
    } catch (error) {
      appendLog(`${service.id} slow-sql status 失败: ${error.message}`, "WARN");
      if (!state.slowSql[service.id]) {
        state.slowSql[service.id] = { supported: null, enabled: false };
      }
    }
  }
  await Promise.all([
    refreshMemoryStatus("order"),
    refreshMemoryStatus("payment"),
    refreshDeadlockStatus("order"),
    refreshDeadlockStatus("payment")
  ]);
  await refreshToxiproxyStatus();
  renderSlowCards();
  renderMemoryCards();
  renderDeadlockCards();
  updateTopologyState();
  const el = document.getElementById("lastRefreshAt");
  if (el) el.textContent = new Date().toLocaleTimeString();
}
