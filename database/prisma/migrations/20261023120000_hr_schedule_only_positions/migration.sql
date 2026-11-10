ALTER TABLE `hr_job_positions`
  ADD COLUMN `schedule_only` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `hr_job_position_stores`
  MODIFY COLUMN `hourly_rate` DECIMAL(12, 2) NULL;

ALTER TABLE `hr_onboarding_requests`
  ADD COLUMN `schedule_only_snapshot` BOOLEAN NOT NULL DEFAULT false;
