ALTER TABLE `hr_approval_workflow_steps` DROP FOREIGN KEY `hr_approval_workflow_steps_kind_fkey`;
ALTER TABLE `hr_approval_instances` DROP FOREIGN KEY `hr_approval_instances_kind_fkey`;

ALTER TABLE `hr_approval_workflows`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING', 'BANK_CHANGE') NOT NULL;
ALTER TABLE `hr_approval_workflow_steps`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING', 'BANK_CHANGE') NOT NULL;
ALTER TABLE `hr_approval_instances`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING', 'BANK_CHANGE') NOT NULL;

ALTER TABLE `hr_approval_workflow_steps` ADD CONSTRAINT `hr_approval_workflow_steps_kind_fkey`
    FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_instances` ADD CONSTRAINT `hr_approval_instances_kind_fkey`
    FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `hr_bank_account_versions`
    MODIFY `onboarding_request_id` BIGINT NULL,
    ADD COLUMN `bank_change_request_id` BIGINT NULL,
    ADD UNIQUE INDEX `hr_bank_account_versions_bank_change_request_id_key` (`bank_change_request_id`);

CREATE TABLE `hr_bank_change_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `revision` INTEGER NOT NULL,
    `source_revision_id` BIGINT NOT NULL,
    `status` ENUM('SUBMITTED', 'REJECTED', 'EFFECTIVE', 'EFFECTIVE_FAILED') NOT NULL DEFAULT 'SUBMITTED',
    `verified_by` BIGINT NOT NULL,
    `verified_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `applied_at` DATETIME(3) NULL,
    `failure_code` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    UNIQUE INDEX `hr_bank_change_requests_source_revision_id_key` (`source_revision_id`),
    UNIQUE INDEX `hr_bank_change_requests_employee_id_revision_key` (`employee_id`, `revision`),
    INDEX `hr_bank_change_requests_store_id_status_created_at_idx` (`store_id`, `status`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_bank_change_requests` ADD CONSTRAINT `hr_bank_change_requests_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_bank_change_requests` ADD CONSTRAINT `hr_bank_change_requests_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_bank_change_requests` ADD CONSTRAINT `hr_bank_change_requests_source_revision_id_fkey`
    FOREIGN KEY (`source_revision_id`) REFERENCES `hr_sensitive_draft_revisions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_bank_account_versions` ADD CONSTRAINT `hr_bank_account_versions_bank_change_request_id_fkey`
    FOREIGN KEY (`bank_change_request_id`) REFERENCES `hr_bank_change_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_BANK_CHANGE_STORE_VERIFY', '门店核验员工银行卡变更'),
    ('HR_BANK_CHANGE_APPROVE', '审批员工银行卡变更');

INSERT INTO `hr_role_permissions` (`role_id`, `permission_code`)
    SELECT `role_id`, 'HR_BANK_CHANGE_STORE_VERIFY' FROM `hr_role_permissions`
    WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT INTO `hr_role_permissions` (`role_id`, `permission_code`)
    SELECT `role_id`, 'HR_BANK_CHANGE_APPROVE' FROM `hr_role_permissions`
    WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';

INSERT INTO `hr_approval_workflows` (`kind`, `version`, `updated_at`)
    SELECT 'BANK_CHANGE', `version`, `updated_at` FROM `hr_approval_workflows` WHERE `kind` = 'ONBOARDING';
INSERT INTO `hr_approval_workflow_steps` (`kind`, `position`, `role_id`)
    SELECT 'BANK_CHANGE', `position`, `role_id` FROM `hr_approval_workflow_steps` WHERE `kind` = 'ONBOARDING';
