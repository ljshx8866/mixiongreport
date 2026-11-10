ALTER TABLE `hr_schedules`
  ADD COLUMN `shift_template_id` BIGINT NULL;

CREATE TABLE `hr_shift_templates` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL,
  `code` VARCHAR(30) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `start_time` VARCHAR(5) NOT NULL,
  `end_time` VARCHAR(5) NOT NULL,
  `break_minutes` INTEGER NOT NULL DEFAULT 0,
  `sort_order` INTEGER NOT NULL DEFAULT 0,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `created_by` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `hr_shift_templates_store_id_code_key` (`store_id`, `code`),
  INDEX `hr_shift_templates_store_id_enabled_sort_order_idx` (`store_id`, `enabled`, `sort_order`),
  PRIMARY KEY (`id`),
  CONSTRAINT `hr_shift_templates_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `hr_schedules_shift_template_id_idx` ON `hr_schedules` (`shift_template_id`);

ALTER TABLE `hr_schedules`
  ADD CONSTRAINT `hr_schedules_shift_template_id_fkey` FOREIGN KEY (`shift_template_id`) REFERENCES `hr_shift_templates` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
