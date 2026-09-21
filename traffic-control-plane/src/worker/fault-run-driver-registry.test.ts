import assert from 'node:assert/strict';
import test from 'node:test';
import { getFaultRunDrivers } from './fault-run-driver-registry';

test('driver registry contains distinct real-path owners', () => {
  const drivers = getFaultRunDrivers();
  assert.deepEqual(
    drivers.map((driver) => driver.name),
    ['REPORT_SCENARIO_WORKER', 'TRAFFIC_SURGE_EXECUTOR', 'SCENARIO_WORKERS', 'RUNNER_ENGINE'],
  );
});
