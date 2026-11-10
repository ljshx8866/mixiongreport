-- Consolidate repeated store-specific job rows into one reusable position.
-- Preserve each store's historical configured wage in the join table.
ALTER TABLE `hr_onboarding_requests`
  ADD COLUMN `job_position_name_snapshot` VARCHAR(100) NULL;

UPDATE `hr_onboarding_requests` AS request
JOIN `hr_job_positions` AS position ON position.`id` = request.`job_position_id`
SET request.`job_position_name_snapshot` = position.`name`
WHERE request.`job_position_id` IS NOT NULL;

CREATE TABLE `hr_job_position_stores` (
  `job_position_id` BIGINT NOT NULL,
  `store_id` BIGINT NOT NULL,
  `hourly_rate` DECIMAL(12, 2) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`job_position_id`, `store_id`),
  INDEX `hr_job_position_stores_store_id_enabled_idx` (`store_id`, `enabled`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TEMPORARY TABLE `hr_job_position_merge_map` (
  `old_id` BIGINT NOT NULL PRIMARY KEY,
  `canonical_id` BIGINT NOT NULL
);

INSERT INTO `hr_job_position_merge_map` (`old_id`, `canonical_id`)
SELECT position.`id`, grouped.`canonical_id`
FROM `hr_job_positions` AS position
JOIN (
  SELECT `name`, MIN(`id`) AS `canonical_id`
  FROM `hr_job_positions`
  GROUP BY `name`
) AS grouped ON grouped.`name` = position.`name`;

INSERT INTO `hr_job_position_stores`
  (`job_position_id`, `store_id`, `hourly_rate`, `enabled`, `created_at`, `updated_at`)
SELECT mapping.`canonical_id`, position.`store_id`, position.`hourly_rate`, position.`enabled`,
  position.`created_at`, position.`updated_at`
FROM `hr_job_positions` AS position
JOIN `hr_job_position_merge_map` AS mapping ON mapping.`old_id` = position.`id`;

UPDATE `hr_onboarding_requests` AS request
JOIN `hr_job_position_merge_map` AS mapping ON mapping.`old_id` = request.`job_position_id`
SET request.`job_position_id` = mapping.`canonical_id`
WHERE request.`job_position_id` IS NOT NULL;

DELETE position
FROM `hr_job_positions` AS position
JOIN `hr_job_position_merge_map` AS mapping ON mapping.`old_id` = position.`id`
WHERE mapping.`old_id` <> mapping.`canonical_id`;

DROP TEMPORARY TABLE `hr_job_position_merge_map`;

ALTER TABLE `hr_job_position_stores`
  ADD CONSTRAINT `hr_job_position_stores_job_position_id_fkey`
    FOREIGN KEY (`job_position_id`) REFERENCES `hr_job_positions` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `hr_job_position_stores_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `hr_job_positions`
  DROP FOREIGN KEY `hr_job_positions_store_id_fkey`,
  DROP INDEX `hr_job_positions_store_id_name_key`,
  DROP INDEX `hr_job_positions_store_id_enabled_idx`,
  DROP COLUMN `store_id`,
  DROP COLUMN `hourly_rate`,
  DROP COLUMN `enabled`,
  ADD UNIQUE INDEX `hr_job_positions_name_key` (`name`);

-- MySQL rejects dropping and re-adding the same foreign-key name in one ALTER.
ALTER TABLE `hr_onboarding_requests`
  DROP FOREIGN KEY `hr_onboarding_requests_job_position_id_fkey`;

ALTER TABLE `hr_onboarding_requests`
  ADD CONSTRAINT `hr_onboarding_requests_job_position_id_fkey`
    FOREIGN KEY (`job_position_id`) REFERENCES `hr_job_positions` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
