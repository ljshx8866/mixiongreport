ALTER TABLE `business_periods` ADD COLUMN `external_shift_id` VARCHAR(100) NULL;
CREATE UNIQUE INDEX `business_periods_external_shift_id_key` ON `business_periods`(`external_shift_id`);
