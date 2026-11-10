CREATE TABLE `hr_job_positions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `hourly_rate` DECIMAL(12, 2) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `hr_job_positions_store_id_name_key`(`store_id`, `name`),
    INDEX `hr_job_positions_store_id_enabled_idx`(`store_id`, `enabled`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_job_positions` ADD CONSTRAINT `hr_job_positions_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `hr_onboarding_requests`
    ADD COLUMN `job_position_id` BIGINT NULL,
    ADD COLUMN `hourly_rate_snapshot` DECIMAL(12, 2) NULL,
    ADD INDEX `hr_onboarding_requests_job_position_id_idx`(`job_position_id`);

ALTER TABLE `hr_onboarding_requests` ADD CONSTRAINT `hr_onboarding_requests_job_position_id_fkey`
    FOREIGN KEY (`job_position_id`) REFERENCES `hr_job_positions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `hr_salary_rates`
    MODIFY `source_change_id` BIGINT NULL,
    ADD COLUMN `source_onboarding_request_id` BIGINT NULL,
    ADD UNIQUE INDEX `hr_salary_rates_source_onboarding_request_id_key`(`source_onboarding_request_id`);

ALTER TABLE `hr_salary_rates` ADD CONSTRAINT `hr_salary_rates_source_onboarding_request_id_fkey`
    FOREIGN KEY (`source_onboarding_request_id`) REFERENCES `hr_onboarding_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
