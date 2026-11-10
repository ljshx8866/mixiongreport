ALTER TABLE `users`
  ADD COLUMN `local_role_override` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `hr_onboarding_requests`
  ADD COLUMN `account_role` ENUM('ADMIN', 'REGION_MANAGER', 'STORE_MANAGER') NULL;
