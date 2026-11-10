CREATE TABLE `hr_schedules` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED', 'CANCELED') NOT NULL DEFAULT 'DRAFT',
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    CONSTRAINT `hr_schedules_version_chk` CHECK (`current_version` > 0),
    INDEX `hr_schedules_store_id_business_date_status_idx` (`store_id`, `business_date`, `status`),
    INDEX `hr_schedules_employee_id_business_date_idx` (`employee_id`, `business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_schedule_versions` (
    `schedule_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `planned_start` DATETIME(3) NOT NULL,
    `planned_end` DATETIME(3) NOT NULL,
    `break_minutes` INTEGER NOT NULL,
    `created_by` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    CONSTRAINT `hr_schedule_times_chk` CHECK (`planned_end` > `planned_start` AND `break_minutes` >= 0 AND `version` > 0),
    PRIMARY KEY (`schedule_id`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_schedule_deliveries` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `schedule_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('UNAVAILABLE', 'QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'UNAVAILABLE',
    `reason_code` VARCHAR(80) NULL,
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `provider_message_id` VARCHAR(150) NULL,
    `last_attempt_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT `hr_delivery_attempts_chk` CHECK (`attempts` >= 0),
    UNIQUE INDEX `hr_schedule_deliveries_schedule_id_version_key` (`schedule_id`, `version`),
    INDEX `hr_schedule_deliveries_status_created_at_idx` (`status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_schedules` ADD CONSTRAINT `hr_schedules_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_schedules` ADD CONSTRAINT `hr_schedules_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_schedule_versions` ADD CONSTRAINT `hr_schedule_versions_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `hr_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_schedule_deliveries` ADD CONSTRAINT `hr_schedule_deliveries_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `hr_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_schedule_deliveries` ADD CONSTRAINT `hr_schedule_deliveries_schedule_id_version_fkey` FOREIGN KEY (`schedule_id`, `version`) REFERENCES `hr_schedule_versions`(`schedule_id`, `version`) ON DELETE RESTRICT ON UPDATE CASCADE;
