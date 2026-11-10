-- CreateTable
CREATE TABLE `hr_employees` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `display_name` VARCHAR(100) NOT NULL,
    `user_id` BIGINT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_employees_user_id_key`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_primary_appointments` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `effective_from` DATE NOT NULL,
    `effective_to_exclusive` DATE NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    CONSTRAINT `hr_primary_appointments_date_order_chk` CHECK (`effective_to_exclusive` IS NULL OR `effective_to_exclusive` > `effective_from`),

    INDEX `hr_primary_appointments_employee_id_effective_to_exclusive_idx`(`employee_id`, `effective_to_exclusive`),
    INDEX `hr_primary_appointments_store_id_effective_from_idx`(`store_id`, `effective_from`),
    UNIQUE INDEX `hr_primary_appointments_employee_id_effective_from_key`(`employee_id`, `effective_from`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_roles` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_permissions` (
    `code` VARCHAR(100) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_role_permissions` (
    `role_id` BIGINT NOT NULL,
    `permission_code` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`role_id`, `permission_code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_role_grants` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `role_id` BIGINT NOT NULL,
    `scope_kind` ENUM('ALL', 'REGION', 'STORE') NOT NULL,
    `scope_id` BIGINT NOT NULL DEFAULT 0,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    CONSTRAINT `hr_role_grants_scope_chk` CHECK ((`scope_kind` = 'ALL' AND `scope_id` = 0) OR (`scope_kind` IN ('REGION', 'STORE') AND `scope_id` > 0)),

    INDEX `hr_role_grants_scope_kind_scope_id_active_idx`(`scope_kind`, `scope_id`, `active`),
    UNIQUE INDEX `hr_role_grants_user_id_role_id_scope_kind_scope_id_key`(`user_id`, `role_id`, `scope_kind`, `scope_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_employees` ADD CONSTRAINT `hr_employees_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_primary_appointments` ADD CONSTRAINT `hr_primary_appointments_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_primary_appointments` ADD CONSTRAINT `hr_primary_appointments_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_role_permissions` ADD CONSTRAINT `hr_role_permissions_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `hr_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_role_permissions` ADD CONSTRAINT `hr_role_permissions_permission_code_fkey` FOREIGN KEY (`permission_code`) REFERENCES `hr_permissions`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_role_grants` ADD CONSTRAINT `hr_role_grants_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_role_grants` ADD CONSTRAINT `hr_role_grants_role_id_fkey` FOREIGN KEY (`role_id`) REFERENCES `hr_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Stable capability codes; role-to-capability mapping remains configurable.
INSERT INTO `hr_permissions` (`code`, `name`) VALUES
('HR_EMPLOYEE_READ', '查看员工基础档案'),
('HR_EMPLOYEE_WRITE', '维护员工基础档案'),
('HR_TRANSFER_REQUEST', '发起转店'),
('HR_TRANSFER_APPROVE_SOURCE', '审批原店转出'),
('HR_TRANSFER_APPROVE_DESTINATION', '审批新店转入'),
('HR_TRANSFER_APPROVE_HR', '人事终审转店'),
('HR_SCHEDULE_READ', '查看排班'),
('HR_SCHEDULE_WRITE', '编排和发布班次'),
('HR_TIME_CONFIRM', '确认实际工时'),
('HR_TIME_CORRECTION_REQUEST', '申请工时更正'),
('HR_TIME_CORRECTION_APPROVE', '审批工时更正'),
('HR_SALARY_CHANGE_REQUEST', '申请薪资变动'),
('HR_SALARY_CHANGE_APPROVE', '审批薪资变动'),
('HR_MONTH_SUBMIT', '提交门店月度审核'),
('HR_MONTH_APPROVE', '审批月度统计'),
('HR_MONTH_EXPORT', '导出月度审核数据');
