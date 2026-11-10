CREATE TABLE `hr_work_records` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `schedule_id` BIGINT NOT NULL,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `current_version` INTEGER NOT NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    CONSTRAINT `hr_work_record_version_chk` CHECK (`current_version` > 0),
    UNIQUE INDEX `hr_work_records_schedule_id_key` (`schedule_id`),
    INDEX `hr_work_records_employee_id_store_id_idx` (`employee_id`, `store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_work_record_versions` (
    `record_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `actual_start` DATETIME(3) NOT NULL,
    `actual_end` DATETIME(3) NOT NULL,
    `breaks` JSON NOT NULL,
    `raw_minutes` INTEGER NOT NULL,
    `confirmed_by` BIGINT NOT NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    CONSTRAINT `hr_work_version_time_chk` CHECK (`actual_end` > `actual_start` AND `raw_minutes` >= 0 AND `version` > 0),
    PRIMARY KEY (`record_id`, `version`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_work_day_segments` (
    `record_id` BIGINT NOT NULL,
    `version` INTEGER NOT NULL,
    `business_date` DATE NOT NULL,
    `elapsed_minutes` INTEGER NOT NULL,
    `break_minutes` INTEGER NOT NULL,
    `raw_minutes` INTEGER NOT NULL,
    CONSTRAINT `hr_work_segment_minutes_chk` CHECK (`elapsed_minutes` >= 0 AND `break_minutes` >= 0 AND `raw_minutes` >= 0 AND `elapsed_minutes` = `break_minutes` + `raw_minutes`),
    INDEX `hr_work_day_segments_business_date_idx` (`business_date`),
    PRIMARY KEY (`record_id`, `version`, `business_date`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_work_records` ADD CONSTRAINT `hr_work_records_schedule_id_fkey` FOREIGN KEY (`schedule_id`) REFERENCES `hr_schedules`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_work_records` ADD CONSTRAINT `hr_work_records_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_work_records` ADD CONSTRAINT `hr_work_records_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_work_record_versions` ADD CONSTRAINT `hr_work_record_versions_record_id_fkey` FOREIGN KEY (`record_id`) REFERENCES `hr_work_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_work_day_segments` ADD CONSTRAINT `hr_work_day_segments_record_id_version_fkey` FOREIGN KEY (`record_id`, `version`) REFERENCES `hr_work_record_versions`(`record_id`, `version`) ON DELETE RESTRICT ON UPDATE CASCADE;
