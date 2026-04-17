// HTTP layer: fetch wrapper, traceId propagation, backoff helpers.

import { state } from "./state.js";

// ── Trace ────────────────────────────────────────────────────────────────────

export function buildTraceId() {
  return Math.random().toString(16).slice(2).padEnd(16, "0");
}

function setTrace(traceId) {
  state.lastTraceId = traceId;
}

// ── Chaos path helper ────────────────────────────────────────────────────────

export function chaosPath(serviceId, suffix) {
  return `/ops/chaos/${serviceId}${suffix}`;
}

// ── Per-service backoff ──────────────────────────────────────────────────────

export function inBackoff(serviceId) {
  return (state.backoffUntil[serviceId] || 0) > Date.now();
}

export function backoffSecondsLeft(serviceId) {
  const until = state.backoffUntil[serviceId] || 0;
  if (until <= Date.now()) return 0;
  return Math.ceil((until - Date.now()) / 1000);
}

export function setBackoff(serviceId, seconds = 30) {
  state.backoffUntil[serviceId] = Date.now() + seconds * 1000;
}

export function clearBackoff(serviceId) {
  delete state.backoffUntil[serviceId];
}

// ── ToxiProxy backoff ────────────────────────────────────────────────────────

export function inToxiproxyBackoff() {
  return state.toxiproxyBackoffUntil > Date.now();
}

export function setToxiproxyBackoff(seconds = 60) {
  state.toxiproxyBackoffUntil = Date.now() + seconds * 1000;
}

export function clearToxiproxyBackoff() {
  state.toxiproxyBackoffUntil = 0;
}

export function toxiproxyBackoffSecondsLeft() {
  if (!inToxiproxyBackoff()) return 0;
  return Math.ceil((state.toxiproxyBackoffUntil - Date.now()) / 1000);
}

// ── Slow-SQL status detection ────────────────────────────────────────────────

export function isMissingSlowSqlStatus(error) {
  if (!error) return false;
  if (error.httpStatus === 404) return true;
  return /no static resource .*slow-sql\/status/i.test(String(error.message || ""));
}

// ── Fetch wrapper ────────────────────────────────────────────────────────────

export async function request(path, options = {}) {
  const sentTraceId = buildTraceId();
  const method = options.method || "GET";
  const headers = {
    "X-Trace-Id": sentTraceId,
    ...(options.headers || {})
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const payload = { method, headers };
  if (options.body !== undefined) {
    payload.body = JSON.stringify(options.body);
  }

  const response = await fetch(path, payload);

  // Extract the real OTel traceId from the response (what Tempo actually indexes).
  const traceparent = response.headers.get("traceparent");
  if (traceparent) {
    const parts = traceparent.split("-");
    if (parts.length >= 2 && parts[1]) setTrace(parts[1]);
  } else {
    const xTraceId = response.headers.get("x-trace-id") || response.headers.get("X-Trace-Id");
    if (xTraceId) setTrace(xTraceId);
  }

  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message = (parsed && (parsed.message || parsed.error))
      ? (parsed.message || parsed.error)
      : `${response.status} ${response.statusText || String(response.status)}`;
    const error = new Error(message);
    error.httpStatus = response.status;
    throw error;
  }

  if (parsed && typeof parsed === "object" && "code" in parsed && "data" in parsed) {
    if (parsed.code !== 200) {
      const error = new Error(parsed.message || "ApiResponse error");
      error.httpStatus = 200;
      throw error;
    }
    return parsed.data;
  }

  return parsed;
}
