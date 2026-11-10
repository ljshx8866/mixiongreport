-- Complete employee exports include sensitive identity and bank details.
-- Add the permission leaf without changing any existing role grants.
INSERT IGNORE INTO `hr_permissions` (`code`, `name`)
VALUES ('HR_EMPLOYEE_EXPORT', '导出员工完整档案（含身份证和银行卡）');
