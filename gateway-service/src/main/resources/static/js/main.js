// Entry point — boots the console after the DOM is ready.

import { renderTopology, renderSlowCards, renderMemoryCards, renderDeadlockCards } from "./render.js";
import { initGrafanaBaseUrl } from "./grafana.js";
import { bindEvents } from "./events.js";
import { refreshAllStatuses } from "./chaos-actions.js";
import { appendLog } from "./log.js";

async function boot() {
  renderTopology();
  renderSlowCards();
  renderMemoryCards();
  renderDeadlockCards();
  await initGrafanaBaseUrl();
  bindEvents();
  appendLog("控制台初始化完成，5s 后开始状态轮询");
  setTimeout(async () => {
    await refreshAllStatuses();
    setInterval(() => {
      refreshAllStatuses().catch(err => appendLog(`轮询失败: ${err.message}`, "WARN"));
    }, 8000);
  }, 5000);
}

boot().catch(error => {
  appendLog(`初始化失败: ${error.message}`, "ERROR");
});
