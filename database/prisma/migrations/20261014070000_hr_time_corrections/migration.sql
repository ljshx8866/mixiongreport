CREATE TABLE `hr_time_corrections` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `record_id` BIGINT NOT NULL,
    `expected_version` INTEGER NOT NULL,
    `proposed_start` DATETIME(3) NOT NULL,
    `proposed_end` DATETIME(3) NOT NULL,
    `proposed_breaks` JSON NOT NULL,
    `proposed_segments` JSON NOT NULL,
    `proposed_raw_minutes` INTEGER NOT NULL,
    `reason` TEXT NOT NULL,
    `requested_by` BIGINT NOT NULL,
    `status` ENUM('PENDING', 'REJECTED', 'APPLIED', 'APPLY_FAILED') NOT NULL DEFAULT 'PENDING',
    `failure_code` VARCHAR(80) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_at` DATETIME(3) NULL,
    CONSTRAINT `hr_correction_time_chk` CHECK (`proposed_end` > `proposed_start` AND `proposed_raw_minutes` >= 0 AND `expected_version` > 0),
    INDEX `hr_time_corrections_record_id_status_idx` (`record_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_time_corrections` ADD CONSTRAINT `hr_time_corrections_record_id_fkey`
    FOREIGN KEY (`record_id`) REFERENCES `hr_work_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
