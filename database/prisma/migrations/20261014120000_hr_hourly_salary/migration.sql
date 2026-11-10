CREATE TABLE `hr_salary_rates` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `hourly_rate` DECIMAL(12, 2) NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to_exclusive` DATE NULL,
    `source_change_id` BIGINT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `hr_salary_rates_source_change_id_key`(`source_change_id`),
    UNIQUE INDEX `hr_salary_rates_employee_id_effective_from_key`(`employee_id`, `effective_from`),
    INDEX `hr_salary_rates_employee_id_effective_to_exclusive_idx`(`employee_id`, `effective_to_exclusive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_salary_change_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `revision` INTEGER NOT NULL,
    `expected_rate_id` BIGINT NULL,
    `proposed_rate` DECIMAL(12, 2) NOT NULL,
    `effective_date` DATE NOT NULL,
    `reason` TEXT NOT NULL,
    `agreement_reference` VARCHAR(200) NULL,
    `requested_by` BIGINT NOT NULL,
    `status` ENUM('SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE', 'REJECTED', 'EFFECTIVE', 'EFFECTIVE_FAILED') NOT NULL DEFAULT 'SUBMITTED',
    `applied_at` DATETIME(3) NULL,
    `failure_code` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `hr_salary_change_requests_employee_id_revision_key`(`employee_id`, `revision`),
    INDEX `hr_salary_change_requests_status_effective_date_idx`(`status`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_salary_rates` ADD CONSTRAINT `hr_salary_rates_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_salary_change_requests` ADD CONSTRAINT `hr_salary_change_requests_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_salary_change_requests` ADD CONSTRAINT `hr_salary_change_requests_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
