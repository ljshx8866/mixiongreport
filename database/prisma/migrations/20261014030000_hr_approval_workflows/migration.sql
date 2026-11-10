CREATE TABLE `hr_approval_workflows` (
    `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW') NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,
    PRIMARY KEY (`kind`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_approval_workflow_steps` (
    `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW') NOT NULL,
    `position` INTEGER NOT NULL,
    `role_id` BIGINT NOT NULL,
    CONSTRAINT `hr_workflow_step_position_chk` CHECK (`position` > 0),
    PRIMARY KEY (`kind`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_approval_instances` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `kind` ENUM('TIME_CORRECTION', 'SALARY_CHANGE', 'MONTHLY_REVIEW') NOT NULL,
    `subject_id` BIGINT NOT NULL,
    `scope_store_id` BIGINT NOT NULL,
    `requested_by` BIGINT NOT NULL,
    `workflow_version` INTEGER NOT NULL,
    `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
    `current_position` INTEGER NULL DEFAULT 1,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    CONSTRAINT `hr_approval_position_chk` CHECK ((`status` = 'PENDING' AND `current_position` IS NOT NULL) OR (`status` <> 'PENDING' AND `current_position` IS NULL)),
    UNIQUE INDEX `hr_approval_instances_kind_subject_id_key` (`kind`, `subject_id`),
    INDEX `hr_approval_instances_scope_store_id_status_idx` (`scope_store_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_approval_instance_steps` (
    `instance_id` BIGINT NOT NULL,
    `position` INTEGER NOT NULL,
    `role_id` BIGINT NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NULL,
    `actor_id` BIGINT NULL,
    `reason` TEXT NULL,
    `decided_at` DATETIME(3) NULL,
    CONSTRAINT `hr_instance_step_decision_chk` CHECK ((`decision` IS NULL AND `actor_id` IS NULL AND `decided_at` IS NULL) OR (`decision` IS NOT NULL AND `actor_id` IS NOT NULL AND `decided_at` IS NOT NULL)),
    PRIMARY KEY (`instance_id`, `position`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_approval_workflow_steps` ADD CONSTRAINT `hr_approval_workflow_steps_kind_fkey` FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_workflow_steps` ADD CONSTRAINT `hr_approval_workflow_steps_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `hr_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_instances` ADD CONSTRAINT `hr_approval_instances_kind_fkey` FOREIGN KEY (`kind`) REFERENCES `hr_approval_workflows`(`kind`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_instance_steps` ADD CONSTRAINT `hr_approval_instance_steps_instance_id_fkey` FOREIGN KEY (`instance_id`) REFERENCES `hr_approval_instances`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `hr_approval_instance_steps` ADD CONSTRAINT `hr_approval_instance_steps_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `hr_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
