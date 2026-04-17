// Grafana / Tempo deep-link utilities and Grafana base URL management.

import { GRAFANA_BASE_STORAGE_KEY } from "./state.js";
import { request } from "./api.js";
import { appendLog } from "./log.js";

// ── URL helpers ───────────────────────────────────────────────────────────────

export function inferGrafanaBaseUrl() {
  const protocol = window.location.protocol || "http:";
  const hostname = window.location.hostname || "localhost";
  return `${protocol}//${hostname}:13000`;
}

export function normalizeBaseUrl(url) {
  return (url || "").trim().replace(/\/+$/, "");
}

export function resolveGrafanaBaseUrl(url) {
  const normalized = normalizeBaseUrl(url);
  return normalized || inferGrafanaBaseUrl();
}

// ── Persistence ───────────────────────────────────────────────────────────────

export async function initGrafanaBaseUrl() {
  const input = document.getElementById("grafanaBaseUrl");
  const saved = normalizeBaseUrl(localStorage.getItem(GRAFANA_BASE_STORAGE_KEY));
  let configured = "";
  try {
    const cfg = await request("/internal/console/config");
    configured = normalizeBaseUrl(cfg?.grafanaBaseUrl);
  } catch (error) {
    appendLog(`读取控制台配置失败，使用本地默认值: ${error.message}`, "WARN");
  }
  input.value = saved || configured || inferGrafanaBaseUrl();
}

export function persistGrafanaBaseUrl() {
  const input = document.getElementById("grafanaBaseUrl");
  const normalized = normalizeBaseUrl(input.value);
  if (normalized) {
    localStorage.setItem(GRAFANA_BASE_STORAGE_KEY, normalized);
    input.value = normalized;
    appendLog(`已保存 Grafana 地址: ${normalized}`);
    return;
  }
  localStorage.removeItem(GRAFANA_BASE_STORAGE_KEY);
  const fallback = inferGrafanaBaseUrl();
  input.value = fallback;
  appendLog(`Grafana 地址为空，回退为 ${fallback}`, "WARN");
}

export function getObserveContext() {
  const input = document.getElementById("grafanaBaseUrl");
  const base = resolveGrafanaBaseUrl(input.value);
  if (!normalizeBaseUrl(input.value)) input.value = base;
  const service = document.getElementById("observeService").value;
  const from = document.getElementById("observeTimeRange").value;
  return { base, service, from, to: "now" };
}

// ── Deep-link builders ────────────────────────────────────────────────────────

export function updateDeepLinkPreview(url) {
  const el = document.getElementById("deepLinkPreview");
  if (el) el.textContent = url || "-";
}

export function openDeepLink(url, label) {
  updateDeepLinkPreview(url);
  window.open(url, "_blank", "noopener,noreferrer");
  appendLog(`深链跳转: ${label}`);
}

export function buildDashboardLink(baseUrl, uid, slug, from, to, vars = {}) {
  const params = new URLSearchParams({ orgId: "1", from, to });
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined && value !== null && value !== "") {
      params.set(`var-${key}`, String(value));
    }
  }
  return `${baseUrl}/d/${uid}/${slug}?${params.toString()}`;
}

export function buildExploreLink(baseUrl, datasourceUid, query, from, to, queryType = "traceql") {
  const pane = {
    datasource: datasourceUid,
    queries: [
      {
        refId: "A",
        datasource: { type: datasourceUid === "tempo" ? "tempo" : "prometheus", uid: datasourceUid },
        queryType,
        query
      }
    ],
    range: { from, to }
  };
  const panes = encodeURIComponent(JSON.stringify({ A: pane }));
  return `${baseUrl}/explore?orgId=1&schemaVersion=1&panes=${panes}`;
}
