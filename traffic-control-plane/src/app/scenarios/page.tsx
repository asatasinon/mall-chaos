'use client';

import { useEffect, useState } from 'react';

interface ScenarioStep {
  type: string;
  action: string;
  path: string;
  body: unknown;
}

interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  stepCount: number;
  steps?: ScenarioStep[];
}

interface StepResult {
  step?: number;
  path?: string;
  success: boolean;
  error?: string;
}

interface ExecRecord {
  op: 'execute' | 'recover';
  ts: string;
  results: StepResult[];
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, ExecRecord[]>>({});

  useEffect(() => {
    fetch('/internal/traffic/scenarios')
      .then((r) => r.json())
      .then((json) => {
        if (json.code === 0) setScenarios(json.data);
      })
      .catch(() => {});
  }, []);

  const pushHistory = (id: string, record: ExecRecord) =>
    setHistory((prev) => ({ ...prev, [id]: [record, ...(prev[id] ?? [])].slice(0, 5) }));

  const runScenario = async (id: string) => {
    setExecuting(id);
    try {
      const res = await fetch(`/internal/traffic/scenarios/${id}/run`, { method: 'POST' });
      const json = await res.json();
      pushHistory(id, { op: 'execute', ts: new Date().toLocaleTimeString(), results: json.data?.results ?? [] });
    } catch (e: any) {
      pushHistory(id, { op: 'execute', ts: new Date().toLocaleTimeString(), results: [{ success: false, error: e.message }] });
    } finally {
      setExecuting(null);
    }
  };

  const recoverScenario = async (id: string) => {
    setExecuting(`recover-${id}`);
    try {
      const res = await fetch(`/internal/traffic/scenarios/${id}/recover`, { method: 'POST' });
      const json = await res.json();
      pushHistory(id, { op: 'recover', ts: new Date().toLocaleTimeString(), results: json.data?.results ?? [] });
    } catch (e: any) {
      pushHistory(id, { op: 'recover', ts: new Date().toLocaleTimeString(), results: [{ success: false, error: e.message }] });
    } finally {
      setExecuting(null);
    }
  };

  const [recoveringAll, setRecoveringAll] = useState(false);
  const [recoverAllResult, setRecoverAllResult] = useState<string | null>(null);

  const recoverAll = async () => {
    setRecoveringAll(true);
    try {
      const res = await fetch('/internal/traffic/scenarios/recover-all', { method: 'POST' });
      const json = await res.json();
      const ok = (json.data?.results ?? []).filter((r: any) => r.success).length;
      const fail = (json.data?.results ?? []).filter((r: any) => !r.success).length;
      setRecoverAllResult(`Done: ${ok} ok, ${fail} failed`);
    } catch (e: any) {
      setRecoverAllResult(`Error: ${e.message}`);
    } finally {
      setRecoveringAll(false);
    }
  };

  const toggleExpand = (id: string) =>
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const busy = executing !== null || recoveringAll;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Preset Scenarios</h1>
        <div className="flex items-center gap-3">
          {recoverAllResult && (
            <span className="text-xs text-gray-400">{recoverAllResult}</span>
          )}
          <button onClick={recoverAll} disabled={busy}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-sm font-semibold">
            {recoveringAll ? 'Recovering…' : 'Recover All'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scenarios.map((s) => (
          <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex flex-col">
            {/* Header */}
            <div className="flex items-start justify-between mb-1">
              <h3 className="text-sm font-semibold text-gray-200">{s.name}</h3>
              <span className="text-xs text-gray-600 font-mono shrink-0 ml-2">{s.id}</span>
            </div>
            <p className="text-xs text-gray-500 mb-1">{s.description}</p>

            {/* Step count + expand toggle */}
            <button
              onClick={() => toggleExpand(s.id)}
              className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 mb-3 w-fit"
            >
              <span>{s.stepCount} step{s.stepCount !== 1 ? 's' : ''}</span>
              <span>{expanded[s.id] ? '▲' : '▼'}</span>
            </button>

            {/* Expanded step list */}
            {expanded[s.id] && s.steps && s.steps.length > 0 && (
              <div className="mb-3 space-y-1">
                {s.steps.map((step, i) => (
                  <div key={i} className="bg-gray-950 border border-gray-800 rounded p-2 text-xs">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                        step.action === 'enable' ? 'bg-red-900/60 text-red-300' :
                        step.action === 'disable' ? 'bg-gray-700 text-gray-300' :
                        'bg-amber-900/60 text-amber-300'
                      }`}>{step.action}</span>
                      <span className="text-gray-500">{step.type}</span>
                    </div>
                    <code className="text-gray-600 break-all">{step.path}</code>
                  </div>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2 mb-3 mt-auto">
              <button
                onClick={() => runScenario(s.id)}
                disabled={busy}
                className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-xs font-medium"
              >
                {executing === s.id ? 'Executing…' : 'Execute'}
              </button>
              <button
                onClick={() => recoverScenario(s.id)}
                disabled={busy}
                className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded text-xs font-medium"
              >
                {executing === `recover-${s.id}` ? 'Recovering…' : 'Recover'}
              </button>
            </div>

            {/* Execution history */}
            {(history[s.id] ?? []).length > 0 && (
              <div className="border-t border-gray-800 pt-2 space-y-1.5">
                {(history[s.id] ?? []).map((rec, i) => {
                  const allOk = rec.results.every((r) => r.success);
                  const failCount = rec.results.filter((r) => !r.success).length;
                  return (
                    <div key={i} className="text-xs flex items-start gap-2">
                      <span className={`shrink-0 px-1.5 py-0.5 rounded font-mono ${
                        rec.op === 'execute' ? 'bg-red-900/40 text-red-400' : 'bg-gray-700 text-gray-400'
                      }`}>{rec.op}</span>
                      <span className="text-gray-600 shrink-0">{rec.ts}</span>
                      <span className={allOk ? 'text-green-400' : 'text-red-400'}>
                        {allOk ? `✓ ${rec.results.length} step${rec.results.length !== 1 ? 's' : ''}` : `✗ ${failCount} failed`}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

