ALTER TABLE `api_sync_logs`
  ADD COLUMN `alerted_at` DATETIME(3) NULL;

UPDATE `api_sync_logs`
SET `alerted_at` = CURRENT_TIMESTAMP(3)
WHERE `status` <> 'FAILED'
   OR `started_at` < UTC_TIMESTAMP(3) - INTERVAL 3 DAY;

CREATE INDEX `api_sync_logs_status_alerted_id_idx`
  ON `api_sync_logs`(`status`, `alerted_at`, `id`);

CREATE TABLE `system_alerts` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `fingerprint` CHAR(64) NOT NULL,
  `source_key` VARCHAR(100) NULL,
  `source` VARCHAR(30) NOT NULL,
  `severity` VARCHAR(20) NOT NULL DEFAULT 'ERROR',
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `title` VARCHAR(191) NOT NULL,
  `message` TEXT NOT NULL,
  `route` VARCHAR(191) NULL,
  `method` VARCHAR(12) NULL,
  `http_status` INTEGER NULL,
  `suggestion` TEXT NULL,
  `occurrence_count` INTEGER NOT NULL DEFAULT 1,
  `first_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `last_seen_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `system_alerts_fingerprint_key`(`fingerprint`),
  UNIQUE INDEX `system_alerts_source_key_key`(`source_key`),
  INDEX `system_alerts_status_severity_seen_idx`(`status`, `severity`, `last_seen_at`),
  INDEX `system_alerts_source_seen_idx`(`source`, `last_seen_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
