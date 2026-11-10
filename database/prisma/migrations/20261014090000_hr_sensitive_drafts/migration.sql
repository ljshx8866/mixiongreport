-- Encrypted HR draft fields only. No source images or plaintext identity/bank values.
CREATE TABLE `hr_sensitive_draft_revisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `kind` ENUM('IDENTITY', 'BANK') NOT NULL,
    `version` INTEGER NOT NULL,
    `sealed_payload` JSON NOT NULL,
    `masked_value` VARCHAR(32) NOT NULL,
    `source` VARCHAR(30) NOT NULL,
    `provider_ref` VARCHAR(100) NULL,
    `created_by` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hr_sensitive_draft_revisions_employee_id_kind_version_key`(`employee_id`, `kind`, `version`),
    INDEX `hr_sensitive_draft_revisions_employee_id_kind_created_at_idx`(`employee_id`, `kind`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_identity_claims` (
    `employee_id` BIGINT NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `version` INTEGER NOT NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_identity_claims_fingerprint_key`(`fingerprint`),
    PRIMARY KEY (`employee_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_sensitive_draft_revisions` ADD CONSTRAINT `hr_sensitive_draft_revisions_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `hr_sensitive_draft_revisions` ADD CONSTRAINT `hr_sensitive_draft_revisions_created_by_fkey`
    FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `hr_identity_claims` ADD CONSTRAINT `hr_identity_claims_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_SENSITIVE_DRAFT_WRITE', '维护入职敏感资料草稿');
