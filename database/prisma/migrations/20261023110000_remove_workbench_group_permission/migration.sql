-- The workbench group follows the permissions of its individual features;
-- remove the temporary group-level capability.
DELETE FROM `hr_role_permissions`
WHERE `permission_code` = 'HR_WORKBENCH_BUSINESS_READ';

DELETE FROM `hr_permissions`
WHERE `code` = 'HR_WORKBENCH_BUSINESS_READ';
