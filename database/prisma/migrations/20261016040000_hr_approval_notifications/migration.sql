CREATE TABLE `hr_approval_notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `subject` ENUM('APPROVAL', 'TRANSFER') NOT NULL,
  `subject_id` BIGINT NOT NULL,
  `stage_key` VARCHAR(30) NOT NULL,
  `purpose` ENUM('PENDING', 'CORRECTION') NOT NULL,
  `recipient_user_id` BIGINT NOT NULL,
  `form_name` VARCHAR(80) NOT NULL,
  `applicant_name` VARCHAR(80) NOT NULL,
  `page` VARCHAR(150) NOT NULL,
  `status` ENUM('QUEUED', 'SENT', 'FAILED') NOT NULL DEFAULT 'QUEUED',
  `reason_code` VARCHAR(80) NULL,
  `attempts` INTEGER NOT NULL DEFAULT 0,
  `last_attempt_at` DATETIME(3) NULL,
  `sent_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `hr_appr_notify_subject_stage_recipient_uq`
    (`subject`, `subject_id`, `stage_key`, `purpose`, `recipient_user_id`),
  INDEX `hr_appr_notify_status_created_idx` (`status`, `created_at`),
  INDEX `hr_appr_notify_recipient_status_created_idx`
    (`recipient_user_id`, `status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
