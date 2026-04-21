'use client';

import { useEffect, useState } from 'react';

interface RunnerStatus {
  running: boolean;
  paused: boolean;
  currentQps: number;
  successRate: number;
  failRate: number;
  totalRequests: number;
  rateMultiplier: number;
}

interface RunnerConfig {
  version: number;
  baseQps: number;
  peakMultiplier: number;
  cycleMinutes: number;
  jitterPct: number;
}

interface ConfigForm {
  baseQps: string;
  peakMultiplier: string;
  cycleMinutes: string;
  jitterPct: string;
}

export default function RunnerPage() {
  const [status, setStatus] = useState<RunnerStatus | null>(null);
  const [config, setConfig] = useState<RunnerConfig | null>(null);
  const [multiplier, setMultiplier] = useState('1.0');
  const [editing, setEditing] = useState(false);
  const [configForm, setConfigForm] = useState<ConfigForm>({ baseQps: '', peakMultiplier: '', cycleMinutes: '', jitterPct: '' });
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadConfig = async () => {
    try {
      const res = await fetch('/internal/traffic/runner/config');
      const json = await res.json();
      if (json.code === 0) {
        setConfig(json.data);
        setConfigForm({
          baseQps: String(json.data.baseQps),
          peakMultiplier: String(json.data.peakMultiplier),
          cycleMinutes: String(json.data.cycleMinutes),
          jitterPct: String((json.data.jitterPct * 100).toFixed(0)),
        });
      }
    } catch {}
  };

  useEffect(() => {
    const load = async () => {
      try {
        const sRes = await fetch('/internal/traffic/runner/status');
        const sJson = await sRes.json();
        if (sJson.code === 0) setStatus(sJson.data);
      } catch {}
    };
    loadConfig();
    load();
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, []);

  const action = async (path: string, body?: unknown) => {
    await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const saveConfig = async () => {
    if (!config) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch('/internal/traffic/runner/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: config.version,
          baseQps: parseFloat(configForm.baseQps),
          peakMultiplier: parseFloat(configForm.peakMultiplier),
          cycleMinutes: parseInt(configForm.cycleMinutes, 10),
          jitterPct: parseFloat(configForm.jitterPct) / 100,
        }),
      });
      const json = await res.json();
      if (json.code === 0) {
        setSaveMsg({ ok: true, text: `Saved — version ${json.data.newVersion}` });
        setEditing(false);
        await loadConfig();
      } else {
        setSaveMsg({ ok: false, text: json.message || 'Save failed' });
      }
    } catch (e: any) {
      setSaveMsg({ ok: false, text: e.message });
    } finally {
      setSaving(false);
    }
  };

  const cancelEdit = () => {
    setEditing(false);
    setSaveMsg(null);
    if (config) {
      setConfigForm({
        baseQps: String(config.baseQps),
        peakMultiplier: String(config.peakMultiplier),
        cycleMinutes: String(config.cycleMinutes),
        jitterPct: String((config.jitterPct * 100).toFixed(0)),
      });
    }
  };

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Runner Control</h1>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Traffic Status</h3>
          {status ? (
            <div className="space-y-2 text-sm">
              <Stat label="Status" value={status.paused ? 'Paused' : status.running ? 'Running' : 'Stopped'}
                    color={status.running && !status.paused ? 'text-green-400' : 'text-yellow-400'} />
              <Stat label="QPS" value={String(status.currentQps)} />
              <Stat label="Success" value={`${(status.successRate * 100).toFixed(1)}%`} />
              <Stat label="Fail" value={`${(status.failRate * 100).toFixed(1)}%`} />
              <Stat label="Total" value={status.totalRequests.toLocaleString()} />
              <Stat label="Multiplier" value={`${status.rateMultiplier}x`} />
            </div>
          ) : (
            <p className="text-xs text-gray-500">Loading...</p>
          )}
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-400 mb-3">Controls</h3>
          <div className="flex gap-2 mb-4">
            <button onClick={() => action('/internal/traffic/runner/resume')}
                    className="px-3 py-1.5 bg-green-700 hover:bg-green-600 rounded text-xs">Resume</button>
            <button onClick={() => action('/internal/traffic/runner/pause')}
                    className="px-3 py-1.5 bg-yellow-700 hover:bg-yellow-600 rounded text-xs">Pause</button>
          </div>
          <div className="flex gap-2 items-center">
            <input type="number" step="0.1" min="0.1" max="10" value={multiplier}
                   onChange={(e) => setMultiplier(e.target.value)}
                   className="w-20 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-xs" />
            <button onClick={() => action('/internal/traffic/runner/rate', { multiplier: parseFloat(multiplier) })}
                    className="px-3 py-1.5 bg-blue-700 hover:bg-blue-600 rounded text-xs">Set Rate</button>
          </div>
        </div>

        {/* Configuration panel */}
        <div className="bg-gray-900 border border-gray-800 rounded-lg p-4 md:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-400">
              Baseline Configuration
              {config && <span className="ml-2 text-xs text-gray-600 font-mono">v{config.version}</span>}
            </h3>
            {!editing ? (
              <button onClick={() => setEditing(true)}
                      className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">
                Edit
              </button>
            ) : (
              <div className="flex gap-2 items-center">
                {saveMsg && (
                  <span className={`text-xs ${saveMsg.ok ? 'text-green-400' : 'text-red-400'}`}>{saveMsg.text}</span>
                )}
                <button onClick={saveConfig} disabled={saving}
                        className="px-3 py-1 bg-green-700 hover:bg-green-600 disabled:opacity-50 rounded text-xs">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={cancelEdit}
                        className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs">
                  Cancel
                </button>
              </div>
            )}
          </div>
          {config ? (
            editing ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <ConfigField
                  label="Base QPS"
                  hint="Requests/sec at baseline"
                  value={configForm.baseQps}
                  onChange={(v) => setConfigForm((f) => ({ ...f, baseQps: v }))}
                  type="number" min="1" step="1"
                />
                <ConfigField
                  label="Peak Multiplier"
                  hint="Max traffic spike factor"
                  value={configForm.peakMultiplier}
                  onChange={(v) => setConfigForm((f) => ({ ...f, peakMultiplier: v }))}
                  type="number" min="1" step="0.1"
                />
                <ConfigField
                  label="Cycle (minutes)"
                  hint="Duration of one traffic cycle"
                  value={configForm.cycleMinutes}
                  onChange={(v) => setConfigForm((f) => ({ ...f, cycleMinutes: v }))}
                  type="number" min="1" step="1"
                />
                <ConfigField
                  label="Jitter %"
                  hint="Random variance in QPS (0–100)"
                  value={configForm.jitterPct}
                  onChange={(v) => setConfigForm((f) => ({ ...f, jitterPct: v }))}
                  type="number" min="0" max="100" step="1"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <Stat label="Base QPS" value={String(config.baseQps)} />
                <Stat label="Peak Multiplier" value={`${config.peakMultiplier}x`} />
                <Stat label="Cycle" value={`${config.cycleMinutes} min`} />
                <Stat label="Jitter" value={`${(config.jitterPct * 100).toFixed(0)}%`} />
              </div>
            )
          ) : (
            <p className="text-xs text-gray-500">Loading...</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={`font-mono ${color || 'text-white'}`}>{value}</span>
    </div>
  );
}

function ConfigField({
  label, hint, value, onChange, type = 'text', min, max, step,
}: {
  label: string; hint: string; value: string;
  onChange: (v: string) => void;
  type?: string; min?: string; max?: string; step?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-gray-500">{label}</label>
      <input
        type={type} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-2 py-1.5 bg-gray-800 border border-gray-700 focus:border-amber-500 rounded text-sm font-mono outline-none"
      />
      <span className="text-xs text-gray-600">{hint}</span>
    </div>
  );
}
