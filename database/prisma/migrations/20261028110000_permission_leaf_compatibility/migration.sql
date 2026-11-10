-- Add the renamed action leaves while keeping every historical permission row
-- and grant. Equivalent leaf grants are copied first so role editing is lossless.
INSERT IGNORE INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_SCHEDULE_LIST_READ', '查看门店排班列表'),
    ('HR_ONBOARDING_VERIFY', '门店核验入职资料'),
    ('HR_BANK_CHANGE_VERIFY', '门店核验银行卡原件')
;

-- Poster generation used to be part of daily-report access. Preserve that
-- existing capability when it becomes a separately configurable action.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`)
SELECT `role_id`, 'HR_DAILY_REPORT_POSTER'
FROM `hr_role_permissions`
WHERE `permission_code` = 'HR_DAILY_REPORT_READ';

-- The workbench sales card used the daily report payload before its dedicated
-- permission existed. Keep it visible for roles that already had report access.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`)
SELECT `role_id`, 'HR_HOME_SALES_READ'
FROM `hr_role_permissions`
WHERE `permission_code` = 'HR_DAILY_REPORT_READ';

-- Employee profile writers previously opened the employee and position details.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_JOB_POSITION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_WRITE';

-- Legacy schedule viewing included the same read pages and correction history.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_READ';

-- The former all-in-one schedule permission allowed the full scheduling workflow.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SHIFT_TEMPLATE_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_POINT_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_JOB_POSITION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_SUBMIT';

-- Former verification roles also had access to the relevant application and
-- permission details; retain those abilities as explicit new leaves.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_VERIFY' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_JOB_POSITION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_VERIFY' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
