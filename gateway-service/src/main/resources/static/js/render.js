// DOM render functions for all dynamic sections of the console.

import { state, slowSqlServices, topologyServices } from "./state.js";
import { inBackoff, backoffSecondsLeft } from "./api.js";

// ── Topology grid ─────────────────────────────────────────────────────────────

export function renderTopology() {
  const grid = document.getElementById("topologyGrid");
  grid.innerHTML = "";
  for (const service of topologyServices) {
    const activeState = state.topology[service.id] || "inactive";
    const node = document.createElement("div");
    node.className = `node state-${activeState}`;
    node.dataset.service = service.id;
    node.innerHTML = `
      <span class="dot"></span>
      <div class="node-name">${service.label}</div>
      <div class="node-meta">${service.role}</div>
    `;
    grid.appendChild(node);
  }
}

// ── Shared card factory ───────────────────────────────────────────────────────

export function makeServiceCard(svc, statusText, statusClass = "unknown") {
  const card = document.createElement("div");
  card.className = `service-card state-${statusClass}`;
  card.innerHTML = `
    <span class="dot"></span>
    <div class="service-name">${svc.label}</div>
    <div class="service-status">${statusText}</div>
  `;
  return card;
}

// ── Slow SQL service cards ────────────────────────────────────────────────────

export function renderSlowCards() {
  const grid = document.getElementById("slowServiceGrid");
  grid.innerHTML = "";
  for (const svc of slowSqlServices) {
    const st = state.slowSql[svc.id] || { supported: null, enabled: false };
    let text = "未知";
    let stateClass = "unknown";

    if (inBackoff(svc.id)) {
      text = `暂时离线，${backoffSecondsLeft(svc.id)}s后重试`;
      stateClass = "unknown";
    } else if (st.supported === false) {
      text = st.enabled ? "已启用（无状态端点）" : "无状态端点";
      stateClass = st.enabled ? "active" : "unknown";
    } else if (st.supported === true) {
      text = st.enabled
        ? `ON · ${st.mode || "-"} · ${st.delayMs || "-"}ms · rate ${st.injectRate ?? "-"}`
        : "OFF";
      stateClass = st.enabled ? "active" : "inactive";
    } else if (st.enabled) {
      text = "已启用（等待刷新）";
      stateClass = "active";
    }

    const card = makeServiceCard(svc, text, stateClass);
    const row = document.createElement("div");
    row.className = "btn-row";
    row.innerHTML = `
      <button data-action="slow-enable" data-target="${svc.id}" class="btn-primary">enable</button>
      <button data-action="slow-disable" data-target="${svc.id}" class="btn-warn">disable</button>
    `;
    card.appendChild(row);
    grid.appendChild(card);
  }
}

// ── Memory leak cards ─────────────────────────────────────────────────────────

export function renderMemoryCards() {
  const grid = document.getElementById("memoryGrid");
  grid.innerHTML = "";
  for (const id of ["order", "payment"]) {
    const st = state.memory[id] || { running: false };
    let text, cardState;
    if (inBackoff(id)) {
      text = `暂时离线，${backoffSecondsLeft(id)}s后重试`;
      cardState = "unknown";
    } else {
      text = st.running
        ? `running · ${st.holdingMb ?? "-"}MB / ${st.maxMb ?? "-"}MB`
        : `stopped · ${st.holdingMb ?? 0}MB`;
      cardState = st.running ? "active" : "inactive";
    }
    grid.appendChild(makeServiceCard({ label: id }, text, cardState));
  }
}

// ── Deadlock cards ────────────────────────────────────────────────────────────

export function renderDeadlockCards() {
  const grid = document.getElementById("deadlockGrid");
  grid.innerHTML = "";
  for (const id of ["order", "payment"]) {
    const st = state.deadlock[id] || { enabled: false };
    let text, cardState;
    if (inBackoff(id)) {
      text = `暂时离线，${backoffSecondsLeft(id)}s后重试`;
      cardState = "unknown";
    } else {
      text = st.enabled
        ? `enabled · count ${st.deadlockCount ?? 0}`
        : `disabled · count ${st.deadlockCount ?? 0}`;
      cardState = st.enabled ? "active" : "inactive";
    }
    grid.appendChild(makeServiceCard({ label: id }, text, cardState));
  }
}

// ── Topology state computation ────────────────────────────────────────────────

export function updateTopologyState() {
  for (const service of topologyServices) {
    if (service.id === "gateway") {
      state.topology.gateway = "inactive";
      continue;
    }
    if (inBackoff(service.id)) {
      state.topology[service.id] = "unknown";
      continue;
    }
    const slow = state.slowSql[service.id]?.enabled;
    const leak = (service.id === "order" || service.id === "payment")
      ? state.memory[service.id]?.running
      : false;
    const dead = (service.id === "order" || service.id === "payment")
      ? state.deadlock[service.id]?.enabled
      : false;
    state.topology[service.id] = (slow || leak || dead) ? "active" : "inactive";
  }
  renderTopology();
}
