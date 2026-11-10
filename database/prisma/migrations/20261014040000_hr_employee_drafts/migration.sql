ALTER TABLE `hr_employees`
    ADD COLUMN `status` ENUM('DRAFT', 'ACTIVE', 'TERMINATED') NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN `initial_store_id` BIGINT NULL;

CREATE INDEX `hr_employees_initial_store_id_status_idx` ON `hr_employees`(`initial_store_id`, `status`);

ALTER TABLE `hr_employees` ADD CONSTRAINT `hr_employees_initial_store_id_fkey`
    FOREIGN KEY (`initial_store_id`) REFERENCES `stores`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
