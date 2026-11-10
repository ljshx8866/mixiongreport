ALTER TABLE `hr_approval_workflow_steps` DROP FOREIGN KEY `hr_approval_workflow_steps_kind_fkey`;
ALTER TABLE `hr_approval_instances` DROP FOREIGN KEY `hr_approval_instances_kind_fkey`;

ALTER TABLE `hr_approval_workflows`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING') NOT NULL;
ALTER TABLE `hr_approval_workflow_steps`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING') NOT NULL;
ALTER TABLE `hr_approval_instances`
    MODIFY `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW', 'ONBOARDING', 'OFFBOARDING') NOT NULL;

ALTER TABLE `hr_approval_workflow_steps` ADD CONSTRAINT `hr_approval_workflow_steps_kind_fkey`
    FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_instances` ADD CONSTRAINT `hr_approval_instances_kind_fkey`
    FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `hr_offboarding_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `revision` INTEGER NOT NULL,
    `effective_date` DATE NOT NULL,
    `reason` TEXT NOT NULL,
    `requested_by` BIGINT NOT NULL,
    `status` ENUM('SUBMITTED', 'APPROVED_AWAITING_EFFECTIVE', 'REJECTED', 'EFFECTIVE', 'EFFECTIVE_FAILED') NOT NULL DEFAULT 'SUBMITTED',
    `applied_at` DATETIME(3) NULL,
    `failure_code` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_offboarding_requests_employee_id_revision_key`(`employee_id`, `revision`),
    INDEX `hr_offboarding_requests_status_effective_date_idx`(`status`, `effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_offboarding_requests` ADD CONSTRAINT `hr_offboarding_requests_employee_id_fkey`
    FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_offboarding_requests` ADD CONSTRAINT `hr_offboarding_requests_store_id_fkey`
    FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_OFFBOARDING_REQUEST', '发起员工离职'),
    ('HR_OFFBOARDING_APPROVE', '审批员工离职');
