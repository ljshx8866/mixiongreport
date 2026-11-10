-- Keep each employee's current reusable position and add store-specific
-- schedule points with a historical name snapshot on every schedule row.
ALTER TABLE `hr_employees`
  ADD COLUMN `job_position_id` BIGINT NULL,
  ADD INDEX `hr_employees_job_position_id_idx` (`job_position_id`),
  ADD CONSTRAINT `hr_employees_job_position_id_fkey`
    FOREIGN KEY (`job_position_id`) REFERENCES `hr_job_positions` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill the latest effective onboarding position where available.
UPDATE `hr_employees` AS employee
JOIN `hr_onboarding_requests` AS request ON request.`employee_id` = employee.`id`
SET employee.`job_position_id` = request.`job_position_id`
WHERE request.`status` = 'EFFECTIVE' AND request.`job_position_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `hr_onboarding_requests` AS newer
    WHERE newer.`employee_id` = request.`employee_id`
      AND newer.`status` = 'EFFECTIVE' AND newer.`job_position_id` IS NOT NULL
      AND (newer.`effective_date` > request.`effective_date`
        OR (newer.`effective_date` = request.`effective_date` AND newer.`revision` > request.`revision`))
  );

CREATE TABLE `hr_schedule_points` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `hr_schedule_points_store_id_name_key` (`store_id`, `name`),
  INDEX `hr_schedule_points_store_id_enabled_sort_order_idx` (`store_id`, `enabled`, `sort_order`),
  CONSTRAINT `hr_schedule_points_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_schedules`
  ADD COLUMN `point_id` BIGINT NULL,
  ADD COLUMN `point_name` VARCHAR(80) NULL,
  ADD INDEX `hr_schedules_point_id_idx` (`point_id`),
  ADD CONSTRAINT `hr_schedules_point_id_fkey`
    FOREIGN KEY (`point_id`) REFERENCES `hr_schedule_points` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE;
