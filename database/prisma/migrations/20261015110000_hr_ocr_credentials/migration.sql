CREATE TABLE `hr_ocr_credentials` (
  `id` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `credential_cipher` JSON NOT NULL,
  `enabled` BOOLEAN NOT NULL DEFAULT false,
  `updated_by` BIGINT NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
