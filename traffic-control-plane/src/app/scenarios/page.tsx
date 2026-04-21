'use client';

import { useEffect, useState } from 'react';

interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  stepCount: number;
}

export default function ScenariosPage() {
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [executing, setExecuting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/internal/traffic/scenarios')
      .then((r) => r.json())
      .then((json) => {
        if (json.code === 0) setScenarios(json.data);
      })
      .catch(() => {});
  }, []);

  const runScenario = async (id: string) => {
    setExecuting(id);
    try {
      const res = await fetch(`/internal/traffic/scenarios/${id}/run`, { method: 'POST' });
      const json = await res.json();
      setResults((prev) => ({ ...prev, [id]: JSON.stringify(json.data, null, 2) }));
    } catch (e: any) {
      setResults((prev) => ({ ...prev, [id]: `Error: ${e.message}` }));
    } finally {
      setExecuting(null);
    }
  };

  const recoverAll = async () => {
    setExecuting('recover-all');
    try {
      const res = await fetch('/internal/traffic/scenarios/recover-all', { method: 'POST' });
      const json = await res.json();
      setResults((prev) => ({ ...prev, 'recover-all': JSON.stringify(json.data, null, 2) }));
    } catch (e: any) {
      setResults((prev) => ({ ...prev, 'recover-all': `Error: ${e.message}` }));
    } finally {
      setExecuting(null);
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Preset Scenarios</h1>
      <div className="mb-4 flex items-center gap-4">
        <button onClick={recoverAll} disabled={executing !== null}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded text-sm font-semibold">
          {executing === 'recover-all' ? 'Recovering...' : 'Recover All'}
        </button>
        {results['recover-all'] && (
          <pre className="text-xs text-gray-400 bg-gray-950 rounded p-2 max-h-20 overflow-auto flex-1">
            {results['recover-all']}
          </pre>
        )}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {scenarios.map((s) => (
          <div key={s.id} className="bg-gray-900 border border-gray-800 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-gray-300">{s.name}</h3>
              <span className="text-xs text-gray-600 font-mono">{s.id}</span>
            </div>
            <p className="text-xs text-gray-500 mb-1">{s.description}</p>
            <p className="text-xs text-gray-600 mb-3">{s.stepCount} step(s)</p>
            <button onClick={() => runScenario(s.id)}
                    disabled={executing !== null}
                    className="px-3 py-1.5 bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded text-xs">
              {executing === s.id ? 'Executing...' : 'Execute'}
            </button>
            {results[s.id] && (
              <pre className="mt-2 text-xs text-gray-400 bg-gray-950 rounded p-2 max-h-24 overflow-auto whitespace-pre-wrap">
                {results[s.id]}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
