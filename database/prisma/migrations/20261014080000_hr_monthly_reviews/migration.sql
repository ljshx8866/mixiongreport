CREATE TABLE `hr_monthly_reviews` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `month` DATE NOT NULL,
    `revision` INTEGER NOT NULL,
    `status` ENUM('SUBMITTED', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'SUBMITTED',
    `snapshot` JSON NOT NULL,
    `snapshot_hash` VARCHAR(64) NOT NULL,
    `submitted_by` BIGINT NOT NULL,
    `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `approved_at` DATETIME(3) NULL,
    `invalidated_at` DATETIME(3) NULL,
    `invalidation_reason` VARCHAR(150) NULL,
    CONSTRAINT `hr_monthly_revision_chk` CHECK (`revision` > 0),
    UNIQUE INDEX `hr_monthly_reviews_store_id_month_revision_key` (`store_id`, `month`, `revision`),
    INDEX `hr_monthly_reviews_store_id_month_status_idx` (`store_id`, `month`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_monthly_reviews` ADD CONSTRAINT `hr_monthly_reviews_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
