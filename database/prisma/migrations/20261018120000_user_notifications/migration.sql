CREATE TABLE `user_notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `category` VARCHAR(30) NOT NULL,
  `title` VARCHAR(120) NOT NULL,
  `summary` VARCHAR(300) NOT NULL,
  `page` VARCHAR(200) NOT NULL,
  `event_key` VARCHAR(191) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `read_at` DATETIME(3) NULL,
  UNIQUE INDEX `user_notifications_user_event_uq` (`user_id`, `event_key`),
  INDEX `user_notifications_user_read_created_idx` (`user_id`, `read_at`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `user_notifications_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
