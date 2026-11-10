ALTER TABLE `users`
  ADD COLUMN `source` ENUM('LOCAL', 'POS') NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN `external_user_id` VARCHAR(100) NULL,
  ADD COLUMN `external_user_code` VARCHAR(100) NULL,
  ADD COLUMN `external_duty_name` VARCHAR(100) NULL,
  ADD COLUMN `last_synced_at` DATETIME(3) NULL;

CREATE UNIQUE INDEX `users_external_user_id_key` ON `users`(`external_user_id`);
CREATE UNIQUE INDEX `users_external_user_code_key` ON `users`(`external_user_code`);
