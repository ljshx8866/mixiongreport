-- Add an independently assignable capability for employees who may submit
-- the daily operating report. Existing store-scoped report users are unchanged.
INSERT INTO `hr_permissions` (`code`, `name`)
VALUES ('HR_DAILY_INPUT_WRITE', '提交门店经营日报')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
