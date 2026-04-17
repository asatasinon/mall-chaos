// DOM event wiring — called once from main.js after DOMContentLoaded.

import { appendLog } from "./log.js";
import { slowSqlServices } from "./state.js";
import {
  slowEnable, slowDisable, memoryAction, deadlockAction,
  refreshSlowStatus, refreshAllStatuses
} from "./chaos-actions.js";
import { renderSlowCards, updateTopologyState } from "./render.js";
import {
  injectDelay, injectResetPeer, removeToxic,
  clearAllToxics, refreshToxiproxyStatus
} from "./toxiproxy.js";
import {
  persistGrafanaBaseUrl, getObserveContext,
  openDeepLink, buildDashboardLink, buildExploreLink
} from "./grafana.js";
import { runScenario, recoverAll } from "./scenarios.js";

export function bindEvents() {
  // Grafana base URL persistence
  const grafanaInput = document.getElementById("grafanaBaseUrl");
  grafanaInput.addEventListener("change", persistGrafanaBaseUrl);
  grafanaInput.addEventListener("blur", persistGrafanaBaseUrl);
  grafanaInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") persistGrafanaBaseUrl();
  });

  // Global refresh
  document.getElementById("refreshAllBtn").addEventListener("click", async () => {
    try {
      await refreshAllStatuses();
      appendLog("状态刷新完成");
    } catch (error) {
      appendLog(`状态刷新失败: ${error.message}`, "ERROR");
    }
  });

  // Slow SQL bulk controls
  document.getElementById("slowEnableAll").addEventListener("click", async () => {
    for (const service of slowSqlServices) {
      try { await slowEnable(service.id); }
      catch (error) { appendLog(`slow-sql enable 失败 @${service.id}: ${error.message}`, "WARN"); }
    }
    await refreshAllStatuses();
  });

  document.getElementById("slowDisableAll").addEventListener("click", async () => {
    for (const service of slowSqlServices) {
      try { await slowDisable(service.id); }
      catch (error) { appendLog(`slow-sql disable 失败 @${service.id}: ${error.message}`, "WARN"); }
    }
    await refreshAllStatuses();
  });

  // Per-card action delegation (slow, memory, deadlock)
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const target = button.dataset.target;
    try {
      if (action === "slow-enable") {
        await slowEnable(target);
        await refreshSlowStatus(target);
        renderSlowCards();
        updateTopologyState();
      } else if (action === "slow-disable") {
        await slowDisable(target);
        await refreshSlowStatus(target);
        renderSlowCards();
        updateTopologyState();
      } else if (action === "mem-start")       { await memoryAction(target, "start"); }
      else if (action === "mem-stop")          { await memoryAction(target, "stop"); }
      else if (action === "mem-clear")         { await memoryAction(target, "clear"); }
      else if (action === "deadlock-enable")   { await deadlockAction(target, "enable"); }
      else if (action === "deadlock-disable")  { await deadlockAction(target, "disable"); }
      else if (action === "deadlock-clear")    { await deadlockAction(target, "clear"); }
    } catch (error) {
      appendLog(`${action} 失败 @${target}: ${error.message}`, "ERROR");
    }
  });

  // Scenario preset buttons
  document.querySelectorAll("button[data-scenario]").forEach(button => {
    button.addEventListener("click", async () => {
      try {
        await runScenario(button.dataset.scenario);
        await refreshAllStatuses();
      } catch (error) {
        appendLog(`场景执行失败 ${button.dataset.scenario}: ${error.message}`, "ERROR");
      }
    });
  });

  // Recover all
  document.getElementById("recoverAllBtn").addEventListener("click", async () => {
    try { await recoverAll(); }
    catch (error) { appendLog(`一键恢复失败: ${error.message}`, "ERROR"); }
  });

  // ToxiProxy controls
  document.getElementById("injectDelayBtn").addEventListener("click", async () => {
    try {
      await injectDelay(
        document.getElementById("proxyName").value,
        document.getElementById("toxicName").value || "chaos-delay",
        Number(document.getElementById("latencyMs").value),
        Number(document.getElementById("jitterMs").value),
        Number(document.getElementById("toxicDuration").value)
      );
      await refreshToxiproxyStatus();
    } catch (error) { appendLog(`注入延迟失败: ${error.message}`, "ERROR"); }
  });

  document.getElementById("injectResetBtn").addEventListener("click", async () => {
    try {
      await injectResetPeer(
        document.getElementById("proxyName").value,
        (document.getElementById("toxicName").value || "chaos-reset") + "-reset"
      );
      await refreshToxiproxyStatus();
    } catch (error) { appendLog(`注入 reset_peer 失败: ${error.message}`, "ERROR"); }
  });

  document.getElementById("removeToxicBtn").addEventListener("click", async () => {
    try {
      await removeToxic(
        document.getElementById("proxyName").value,
        document.getElementById("toxicName").value || "chaos-delay"
      );
      await refreshToxiproxyStatus();
    } catch (error) { appendLog(`移除 toxic 失败: ${error.message}`, "ERROR"); }
  });

  document.getElementById("clearToxicsBtn").addEventListener("click", async () => {
    try {
      await clearAllToxics();
      await refreshToxiproxyStatus();
    } catch (error) { appendLog(`清空 toxics 失败: ${error.message}`, "ERROR"); }
  });

  document.getElementById("refreshToxiBtn").addEventListener("click", refreshToxiproxyStatus);

  // Event log clear
  document.getElementById("clearLogBtn").addEventListener("click", () => {
    const el = document.getElementById("eventLog");
    if (el) el.textContent = "日志已清空。";
  });

  // Observability deep links
  document.getElementById("openServicesOverviewBtn").addEventListener("click", () => {
    const { base, from, to } = getObserveContext();
    openDeepLink(
      buildDashboardLink(base, "castrel-services-overview", "services-overview", from, to),
      "Services Overview"
    );
  });

  document.getElementById("openChaosEventsBtn").addEventListener("click", () => {
    const { base, from, to } = getObserveContext();
    openDeepLink(
      buildDashboardLink(base, "castrel-chaos-events", "chaos-events", from, to),
      "Chaos Events"
    );
  });

  document.getElementById("openServiceOverviewBtn").addEventListener("click", () => {
    const { base, service, from, to } = getObserveContext();
    if (service === "all") {
      openDeepLink(
        buildDashboardLink(base, "castrel-services-overview", "services-overview", from, to),
        "Services Overview (all)"
      );
      return;
    }
    openDeepLink(
      buildDashboardLink(base, "castrel-services-overview", "services-overview", from, to, { service }),
      `Services Overview (${service})`
    );
  });

  document.getElementById("openTempoServiceBtn").addEventListener("click", () => {
    const { base, service, from, to } = getObserveContext();
    if (service === "all") {
      appendLog("请先选择具体 service 再查看 Tempo", "WARN");
      return;
    }
    openDeepLink(
      buildExploreLink(base, "tempo", `{ resource.service.name = "${service}" }`, from, to, "traceql"),
      `Tempo Service (${service})`
    );
  });
}
