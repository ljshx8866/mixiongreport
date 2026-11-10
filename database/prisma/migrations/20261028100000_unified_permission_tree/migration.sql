-- Add the new action leaves first, then copy each old grant to its equivalent leaves.
-- Existing role grants, accounts, and store assignments are retained unchanged.
INSERT IGNORE INTO `hr_permissions` (`code`, `name`) VALUES
    ('HR_HOME_SALES_READ', '查看经营数据卡片'),
    ('HR_DAILY_INPUT_WRITE', '录入、修改并提交每日填报'),
    ('HR_DAILY_REPORT_READ', '查看当日经营日报'),
    ('HR_DAILY_REPORT_POSTER', '生成、保存和转发日报图片'),
    ('HR_HISTORY_REPORT_READ', '按日期查看历史日报'),
    ('HR_REMINDER_READ', '查看填报提醒'),
    ('HR_REMINDER_PROCESS', '处理填报提醒'),
    ('HR_MY_PROFILE_READ', '查看本人资料'),
    ('HR_MY_SCHEDULE_READ', '查看本人排班'),
    ('HR_MY_WORK_READ', '查看本人确认工时和工时工资'),
    ('HR_SCHEDULE_READ', '查看门店排班'),
    ('HR_SCHEDULE_DRAFT_EDIT', '新增和修改未发布排班'),
    ('HR_SCHEDULE_DRAFT_DELETE', '删除未发布排班'),
    ('HR_SCHEDULE_PUBLISH', '发布排班'),
    ('HR_SCHEDULE_REVISE', '调整已发布排班并重新发布'),
    ('HR_SHIFT_TEMPLATE_READ', '查看班次设置'),
    ('HR_SHIFT_TEMPLATE_EDIT', '新增和修改班次'),
    ('HR_SHIFT_TEMPLATE_DELETE', '删除班次'),
    ('HR_SCHEDULE_POINT_READ', '查看点位设置'),
    ('HR_SCHEDULE_POINT_EDIT', '新增和修改点位'),
    ('HR_SCHEDULE_POINT_DELETE', '删除点位'),
    ('HR_TIME_LIST_READ', '查看当日工时确认列表'),
    ('HR_TIME_ADJUST', '调整实际上下班和休息时间'),
    ('HR_TIME_CONFIRM_ONE', '逐人确认工时'),
    ('HR_TIME_BULK_CONFIRM', '一键确认当前全部班次'),
    ('HR_WORK_STATISTICS_READ', '查看工时和工时工资统计'),
    ('HR_TIME_CORRECTION_READ', '查看工时更正记录'),
    ('HR_TIME_CORRECTION_EDIT', '修改已发布工时'),
    ('HR_TIME_CORRECTION_DELETE', '删除已发布工时'),
    ('HR_MONTH_LIST_READ', '查看月度工时审核列表和详情'),
    ('HR_MONTH_SUBMIT', '提交月度工时审核'),
    ('HR_MONTH_APPROVE', '审批月度工时审核'),
    ('HR_MONTH_EXPORT', '导出月度工时审核'),
    ('HR_EMPLOYEE_LIST_READ', '查看员工列表'),
    ('HR_EMPLOYEE_DETAIL_READ', '查看员工详情'),
    ('HR_EMPLOYEE_SENSITIVE_READ', '查看完整身份证和银行卡资料'),
    ('HR_EMPLOYEE_SENSITIVE_EDIT', '修改员工手机号和住址等敏感资料'),
    ('HR_EMPLOYEE_EDIT', '编辑员工资料和岗位'),
    ('HR_EMPLOYEE_ACCOUNT_LINK', '关联员工账号'),
    ('HR_ONBOARDING_CREATE', '填写并提交入职申请'),
    ('HR_ONBOARDING_LIST_READ', '查看入职申请列表'),
    ('HR_ONBOARDING_DETAIL_READ', '查看入职申请详情'),
    ('HR_ONBOARDING_STORE_VERIFY', '门店核验入职资料'),
    ('HR_ONBOARDING_APPROVE', '审批入职申请'),
    ('HR_JOB_POSITION_READ', '查看岗位'),
    ('HR_OFFBOARDING_REQUEST', '发起或重新提交离职申请'),
    ('HR_OFFBOARDING_LIST_READ', '查看离职申请列表和详情'),
    ('HR_OFFBOARDING_APPROVE', '审批离职申请'),
    ('HR_TRANSFER_REQUEST', '发起或重新提交转店申请'),
    ('HR_TRANSFER_LIST_READ', '查看转店记录和详情'),
    ('HR_TRANSFER_APPROVE_SOURCE', '审批原店转出'),
    ('HR_TRANSFER_APPROVE_DESTINATION', '审批新店转入'),
    ('HR_TRANSFER_APPROVE_HR', '人事终审转店'),
    ('HR_SALARY_CHANGE_REQUEST', '提交或重新提交调薪申请'),
    ('HR_SALARY_CHANGE_LIST_READ', '查看调薪申请列表和详情'),
    ('HR_SALARY_CHANGE_APPROVE', '审批调薪申请'),
    ('HR_BANK_CHANGE_SUBMIT', '提交或重新提交银行卡变更'),
    ('HR_BANK_CHANGE_LIST_READ', '查看银行卡变更列表和详情'),
    ('HR_BANK_CHANGE_FULL_READ', '查看完整银行卡号'),
    ('HR_BANK_CHANGE_STORE_VERIFY', '门店核验银行卡原件'),
    ('HR_BANK_CHANGE_APPROVE', '审批银行卡变更'),
    ('HR_APPROVAL_LIST_READ', '查看全部状态的审批列表'),
    ('HR_APPROVAL_DETAIL_READ', '查看审批详情和审批日志')
;

-- Legacy broad capabilities expand to their former behavior so current roles do not lose access.
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_SENSITIVE_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_ACCOUNT_LINK' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_SENSITIVE_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_EMPLOYEE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_CREATE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SENSITIVE_DRAFT_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_SENSITIVE_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SENSITIVE_DRAFT_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CORRECTION_REQUEST';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CORRECTION_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CORRECTION_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_DELETE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CORRECTION_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SHIFT_TEMPLATE_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_POINT_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_READ';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_DRAFT_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_DRAFT_DELETE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_PUBLISH' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_REVISE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_ADJUST' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CONFIRM_ONE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_BULK_CONFIRM' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_WORK_STATISTICS_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CORRECTION_DELETE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SHIFT_TEMPLATE_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SHIFT_TEMPLATE_DELETE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_POINT_EDIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SCHEDULE_POINT_DELETE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SCHEDULE_WRITE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CONFIRM';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_ADJUST' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CONFIRM';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_CONFIRM_ONE' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CONFIRM';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TIME_BULK_CONFIRM' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CONFIRM';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_WORK_STATISTICS_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TIME_CONFIRM';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_SENSITIVE_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_ONBOARDING_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_EMPLOYEE_SENSITIVE_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_JOB_POSITION_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_ONBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_SUBMIT' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_FULL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_STORE_VERIFY';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_BANK_CHANGE_FULL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_BANK_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SALARY_CHANGE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SALARY_CHANGE_REQUEST';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_SALARY_CHANGE_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SALARY_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SALARY_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_SALARY_CHANGE_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_OFFBOARDING_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_OFFBOARDING_REQUEST';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_OFFBOARDING_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_OFFBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_OFFBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_OFFBOARDING_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TRANSFER_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_REQUEST';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TRANSFER_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_SOURCE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_SOURCE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_SOURCE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TRANSFER_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_DESTINATION';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_DESTINATION';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_DESTINATION';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_TRANSFER_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_HR';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_HR';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_TRANSFER_APPROVE_HR';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_MONTH_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_MONTH_SUBMIT';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_MONTH_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_MONTH_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_MONTH_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_APPROVAL_DETAIL_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_MONTH_APPROVE';
INSERT IGNORE INTO `hr_role_permissions` (`role_id`, `permission_code`) SELECT `role_id`, 'HR_MONTH_LIST_READ' FROM `hr_role_permissions` WHERE `permission_code` = 'HR_MONTH_EXPORT';

-- The old permission rows are intentionally kept for auditability and mixed-version rollback.
