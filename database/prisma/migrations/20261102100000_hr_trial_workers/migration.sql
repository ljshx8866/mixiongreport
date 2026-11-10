ALTER TABLE `hr_employees`
  MODIFY COLUMN `status` ENUM('DRAFT', 'TRIAL', 'ACTIVE', 'TERMINATED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `trial_started_at` DATE NULL;

INSERT IGNORE INTO `hr_permissions` (`code`, `name`)
VALUES ('HR_TRIAL_MANAGE', '录入和结束试岗');
