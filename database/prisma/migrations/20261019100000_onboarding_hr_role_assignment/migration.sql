ALTER TABLE `hr_roles`
  ADD COLUMN `onboarding_assignable` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `hr_onboarding_requests`
  ADD COLUMN `account_hr_role_id` BIGINT NULL,
  ADD INDEX `hr_onboarding_requests_account_hr_role_id_idx` (`account_hr_role_id`),
  ADD CONSTRAINT `hr_onboarding_requests_account_hr_role_id_fkey`
    FOREIGN KEY (`account_hr_role_id`) REFERENCES `hr_roles` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;
