CREATE TABLE `hr_onboarding_intake_drafts` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `actor_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,
    `sealed_payload` JSON NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hr_onboarding_intake_drafts_actor_id_store_id_key`(`actor_id`, `store_id`),
    INDEX `hr_onboarding_intake_drafts_expires_at_idx`(`expires_at`),
    INDEX `hr_onboarding_intake_drafts_store_id_idx`(`store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hr_onboarding_intake_drafts`
  ADD CONSTRAINT `hr_onboarding_intake_drafts_actor_id_fkey`
  FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `hr_onboarding_intake_drafts`
  ADD CONSTRAINT `hr_onboarding_intake_drafts_store_id_fkey`
  FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
