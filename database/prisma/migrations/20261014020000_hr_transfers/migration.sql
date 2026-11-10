-- CreateTable
CREATE TABLE `hr_transfer_requests` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `employee_id` BIGINT NOT NULL,
    `from_store_id` BIGINT NOT NULL,
    `to_store_id` BIGINT NOT NULL,
    `requested_effective_date` DATE NOT NULL,
    `status` ENUM('PENDING', 'APPROVED_AWAITING_EFFECTIVE', 'REJECTED', 'EFFECTIVE', 'EFFECTIVE_FAILED') NOT NULL DEFAULT 'PENDING',
    `next_step` ENUM('SOURCE_STORE', 'DESTINATION_STORE', 'HR') NULL DEFAULT 'SOURCE_STORE',
    `requested_by` BIGINT NOT NULL,
    `reason` TEXT NOT NULL,
    `version` INTEGER NOT NULL DEFAULT 0,
    `applied_at` DATETIME(3) NULL,
    `reconciliation_required` BOOLEAN NOT NULL DEFAULT false,
    `failure_code` VARCHAR(50) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    CONSTRAINT `hr_transfer_distinct_stores_chk` CHECK (`from_store_id` <> `to_store_id`),
    CONSTRAINT `hr_transfer_pending_step_chk` CHECK ((`status` = 'PENDING' AND `next_step` IS NOT NULL) OR (`status` <> 'PENDING' AND `next_step` IS NULL)),

    INDEX `hr_transfer_requests_employee_id_status_idx`(`employee_id`, `status`),
    INDEX `hr_transfer_requests_status_requested_effective_date_idx`(`status`, `requested_effective_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `hr_transfer_decisions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `transfer_id` BIGINT NOT NULL,
    `step` ENUM('SOURCE_STORE', 'DESTINATION_STORE', 'HR') NOT NULL,
    `decision` ENUM('APPROVE', 'REJECT') NOT NULL,
    `actor_user_id` BIGINT NOT NULL,
    `reason` TEXT NULL,
    `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `hr_transfer_decisions_transfer_id_step_key`(`transfer_id`, `step`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `hr_transfer_requests` ADD CONSTRAINT `hr_transfer_requests_employee_id_fkey` FOREIGN KEY (`employee_id`) REFERENCES `hr_employees`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `hr_transfer_requests` ADD CONSTRAINT `hr_transfer_requests_from_store_id_fkey` FOREIGN KEY (`from_store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `hr_transfer_requests` ADD CONSTRAINT `hr_transfer_requests_to_store_id_fkey` FOREIGN KEY (`to_store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `hr_transfer_decisions` ADD CONSTRAINT `hr_transfer_decisions_transfer_id_fkey` FOREIGN KEY (`transfer_id`) REFERENCES `hr_transfer_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
