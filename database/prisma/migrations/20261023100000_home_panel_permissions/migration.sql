-- Add store-scoped capabilities to control the home sales card and the
-- operating-management group on the mini-program workbench.
INSERT INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_HOME_SALES_READ', '查看首页经营数据卡片'),
    ('HR_WORKBENCH_BUSINESS_READ', '查看工作台经营管理模块')
ON DUPLICATE KEY UPDATE `name` = VALUES(`name`);
