CREATE TABLE `hr_bank_account_versions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `source_revision_id` BIGINT NOT NULL,
    `onboarding_request_id` BIGINT NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to_exclusive` DATE NULL,
    `approved_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hr_bank_account_versions_source_revision_id_key`(`source_revision_id`),
    UNIQUE INDEX `hr_bank_account_versions_onboarding_request_id_key`(`onboarding_request_id`),
    INDEX `hr_bank_account_versions_employee_id_effective_from_idx`(`employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_bank_account_versions` ADD CONSTRAINT `hr_bank_account_versions_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_bank_account_versions` ADD CONSTRAINT `hr_bank_account_versions_source_revision_id_fkey`
    FOREIGN KEY (`source_revision_id`) REFERENCES `hr_sensitive_draft_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_bank_account_versions` ADD CONSTRAINT `hr_bank_account_versions_onboarding_request_id_fkey`
    FOREIGN KEY (`onboarding_request_id`) REFERENCES `hr_onboarding_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
