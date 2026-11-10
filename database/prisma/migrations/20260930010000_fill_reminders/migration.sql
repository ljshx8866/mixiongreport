CREATE TABLE `fill_reminder_configs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `store_id` BIGINT NOT NULL,
  `reminder_time` CHAR(5) NOT NULL,
  `template_id` VARCHAR(100) NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT true,
  `escalation_minutes` INT NOT NULL DEFAULT 15,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `fill_reminder_configs_store_id_key`(`store_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `fill_reminder_recipients` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `config_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `priority` INT NOT NULL DEFAULT 1,
  UNIQUE INDEX `fill_reminder_recipients_config_id_user_id_key`(`config_id`, `user_id`),
  INDEX `fill_reminder_recipients_config_id_priority_idx`(`config_id`, `priority`),
  PRIMARY KEY (`id`),
  CONSTRAINT `fill_reminder_recipients_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `fill_reminder_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `fill_reminder_tasks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `config_id` BIGINT NOT NULL,
  `store_id` BIGINT NOT NULL,
  `business_date` DATE NOT NULL,
  `current_user_id` BIGINT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
  `last_reminded_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `fill_reminder_tasks_config_id_business_date_key`(`config_id`, `business_date`),
  INDEX `fill_reminder_tasks_current_user_id_status_idx`(`current_user_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `fill_reminder_tasks_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `fill_reminder_configs`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `fill_reminder_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `actor_user_id` BIGINT NULL,
  `target_user_id` BIGINT NOT NULL,
  `action` VARCHAR(30) NOT NULL,
  `status` VARCHAR(30) NOT NULL,
  `error_message` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `fill_reminder_logs_task_id_created_at_idx`(`task_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `fill_reminder_logs_task_id_fkey` FOREIGN KEY (`task_id`) REFERENCES `fill_reminder_tasks`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
