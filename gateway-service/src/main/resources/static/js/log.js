// Lightweight in-page event log. Reads #eventLog lazily so it is safe to
// import before the DOM is ready (as long as appendLog is called after DOMContentLoaded).

function nowText() {
  return new Date().toLocaleTimeString();
}

export function appendLog(message, level = "INFO") {
  const el = document.getElementById("eventLog");
  if (!el) return;
  const line = `[${nowText()}] [${level}] ${message}`;
  el.textContent = `${line}\n${el.textContent}`.trim();
}
