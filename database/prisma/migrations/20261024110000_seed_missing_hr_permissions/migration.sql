-- These capabilities are exposed by the role editor and accepted by the API.
-- Seed them before role permissions reference them, otherwise MySQL rejects
-- saving a role with a foreign-key error on permission_code.
INSERT INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_DAILY_REPORT_READ', '查看当日经营日报'),
    ('HR_HISTORY_REPORT_READ', '查看历史经营日报'),
    ('HR_REMINDER_READ', '查看和处理填报提醒')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
