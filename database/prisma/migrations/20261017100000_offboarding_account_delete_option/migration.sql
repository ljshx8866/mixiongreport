ALTER TABLE `hr_offboarding_requests`
    ADD COLUMN `delete_account_on_effective` BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing applications did not ask whether to remove a login account.
UPDATE `hr_offboarding_requests`
SET `delete_account_on_effective` = FALSE;

ALTER TABLE `hr_offboarding_requests`
    MODIFY COLUMN `delete_account_on_effective` BOOLEAN NOT NULL DEFAULT TRUE;
