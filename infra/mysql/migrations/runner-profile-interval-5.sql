-- Allow the five-second customer lifecycle interval in existing databases.
-- Apply this migration once together with the updated control-plane version.

ALTER TABLE runner_profile
  DROP CHECK chk_runner_profile_interval,
  ADD CONSTRAINT chk_runner_profile_interval
    CHECK (lifecycle_interval_sec IN (60, 30, 20, 10, 5));