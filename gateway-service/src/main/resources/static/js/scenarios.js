// Preset scenario runners and global recovery (task-19 scenarios).

import { request, chaosPath } from "./api.js";
import { appendLog } from "./log.js";
import { injectDelay } from "./toxiproxy.js";
import { clearAllToxics } from "./toxiproxy.js";
import { slowDisable, refreshAllStatuses } from "./chaos-actions.js";
import { slowSqlServices } from "./state.js";

export async function runScenario(id) {
  appendLog(`开始执行预设 ${id}`);
  if (id === "s2") {
    await injectDelay("order-to-payment", "chaos-delay", 3000, 1000, 300);
  } else if (id === "s4") {
    await request(chaosPath("payment", "/internal/chaos/slow-sql/enable"), {
      method: "POST",
      body: { mode: "sleep", delayMs: 3000, injectRate: 1.0, durationSec: 180 }
    });
  } else if (id === "s5") {
    await request(chaosPath("order", "/internal/chaos/deadlock/enable"), {
      method: "POST",
      body: { injectRate: 0.4, durationSec: 180 }
    });
    await request(chaosPath("payment", "/internal/chaos/deadlock/enable"), {
      method: "POST",
      body: { injectRate: 0.3, durationSec: 180 }
    });
  } else if (id === "s7") {
    await injectDelay("order-to-payment", "chaos-combo-delay", 2000, 500, 300);
    await request(chaosPath("order", "/internal/chaos/slow-sql/enable"), {
      method: "POST",
      body: { mode: "sleep", delayMs: 1500, injectRate: 0.5, durationSec: 300 }
    });
    await request(chaosPath("order", "/internal/chaos/deadlock/enable"), {
      method: "POST",
      body: { injectRate: 0.2, durationSec: 300 }
    });
  }
  appendLog(`预设 ${id} 执行完成`);
}

export async function recoverAll() {
  appendLog("开始执行一键恢复", "WARN");

  for (const service of slowSqlServices) {
    try { await slowDisable(service.id); } catch { /* best-effort */ }
  }

  for (const serviceId of ["order", "payment"]) {
    for (const ep of ["/internal/chaos/memory-leak/stop", "/internal/chaos/memory-leak/clear"]) {
      try { await request(chaosPath(serviceId, ep), { method: "POST" }); } catch { /* best-effort */ }
    }
    for (const ep of ["/internal/chaos/deadlock/disable", "/internal/chaos/deadlock/clear"]) {
      try { await request(chaosPath(serviceId, ep), { method: "POST" }); } catch { /* best-effort */ }
    }
  }

  try { await clearAllToxics(); } catch { /* best-effort */ }

  await refreshAllStatuses();
  appendLog("一键恢复完成", "WARN");
}
