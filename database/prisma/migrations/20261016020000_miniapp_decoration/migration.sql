CREATE TABLE `miniapp_decorations` (
  `id` INT NOT NULL DEFAULT 1,
  `home_title` VARCHAR(100) NOT NULL DEFAULT '米熊 · 经营工作台',
  `home_subtitle` VARCHAR(200) NOT NULL DEFAULT '常用功能一目了然',
  `default_home_modules` JSON NOT NULL,
  `home_banner_image` LONGBLOB NULL,
  `home_banner_mime_type` VARCHAR(30) NULL,
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `miniapp_decorations` (`id`, `home_title`, `home_subtitle`, `default_home_modules`)
VALUES (1, '米熊 · 经营工作台', '常用功能一目了然', JSON_ARRAY('input', 'report', 'history', 'reminders'));
