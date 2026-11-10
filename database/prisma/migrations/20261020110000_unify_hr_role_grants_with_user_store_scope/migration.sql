-- A role grant defines account capabilities. UserStore is the sole source of
-- store scope for both operating and HR features. Preserve the union of each
-- active, enabled role's existing scope in UserStore before removing scopes.
CREATE TEMPORARY TABLE `hr_role_scope_store_additions` AS
SELECT DISTINCT `grant_row`.`user_id`, `store`.`id` AS `store_id`
FROM `hr_role_grants` AS `grant_row`
INNER JOIN `users` AS `user_row`
    ON `user_row`.`id` = `grant_row`.`user_id` AND `user_row`.`status` = true
INNER JOIN `hr_roles` AS `role_row`
    ON `role_row`.`id` = `grant_row`.`role_id` AND `role_row`.`enabled` = true
INNER JOIN `hr_role_permissions` AS `permission_row`
    ON `permission_row`.`role_id` = `role_row`.`id`
INNER JOIN `stores` AS `store`
    ON `store`.`status` = true
    AND (
        `grant_row`.`scope_kind` = 'ALL'
        OR (`grant_row`.`scope_kind` = 'STORE' AND `grant_row`.`scope_id` = `store`.`id`)
        OR (`grant_row`.`scope_kind` = 'REGION' AND `grant_row`.`scope_id` = `store`.`region_id`)
    )
LEFT JOIN `user_stores` AS `existing_scope`
    ON `existing_scope`.`user_id` = `grant_row`.`user_id`
    AND `existing_scope`.`store_id` = `store`.`id`
WHERE `grant_row`.`active` = true AND `existing_scope`.`id` IS NULL;

INSERT INTO `audit_logs` (
    `user_id`, `entity_type`, `entity_id`, `action`, `before_data`, `after_data`, `reason`, `created_at`
)
SELECT
    NULL,
    'USER_STORE',
    `addition`.`user_id`,
    'UNIFY_HR_STORE_SCOPE',
    (SELECT JSON_ARRAYAGG(CAST(`current_scope`.`store_id` AS CHAR))
        FROM `user_stores` AS `current_scope` WHERE `current_scope`.`user_id` = `addition`.`user_id`),
    JSON_OBJECT('addedStoreIds', JSON_ARRAYAGG(CAST(`addition`.`store_id` AS CHAR)),
        'scopeSource', 'active HR role grants'),
    'Merge active HR role store scopes into the shared UserStore account scope.',
    NOW(3)
FROM `hr_role_scope_store_additions` AS `addition`
GROUP BY `addition`.`user_id`;

INSERT INTO `user_stores` (`user_id`, `store_id`)
SELECT `user_id`, `store_id` FROM `hr_role_scope_store_additions`;

-- Keep the merged scope authoritative on future POS syncs. The sync still
-- updates POS identity and enabled state for these accounts.
UPDATE `users` AS `user_row`
INNER JOIN (
    SELECT DISTINCT `user_id` FROM `hr_role_scope_store_additions`
) AS `merged_users` ON `merged_users`.`user_id` = `user_row`.`id`
SET `user_row`.`local_role_override` = true;

DROP TEMPORARY TABLE `hr_role_scope_store_additions`;

-- Preserve the former scoped grant rows in audit history before collapsing
-- one account's role assignments into one account-level grant.
CREATE TEMPORARY TABLE `hr_role_grant_scope_rollup` AS
SELECT
    MIN(`id`) AS `keep_id`,
    `user_id`,
    `role_id`,
    MAX(`active`) AS `active_value`,
    COUNT(*) AS `grant_count`,
    JSON_ARRAYAGG(JSON_OBJECT(
        'id', CAST(`id` AS CHAR),
        'scopeKind', `scope_kind`,
        'scopeId', CAST(`scope_id` AS CHAR),
        'active', `active`
    )) AS `previous_grants`
FROM `hr_role_grants`
GROUP BY `user_id`, `role_id`;

INSERT INTO `audit_logs` (
    `user_id`, `entity_type`, `entity_id`, `action`, `before_data`, `after_data`, `reason`, `created_at`
)
SELECT
    NULL,
    'HR_ROLE_GRANT',
    `keep_id`,
    'UNIFY_STORE_SCOPE',
    `previous_grants`,
    JSON_OBJECT(
        'userId', CAST(`user_id` AS CHAR),
        'roleId', CAST(`role_id` AS CHAR),
        'active', `active_value`,
        'previousGrantCount', `grant_count`,
        'storeScopeSource', 'user_stores'
    ),
    'Consolidate former scoped HR role grants into one account capability grant; user_stores is the shared store scope.',
    NOW(3)
FROM `hr_role_grant_scope_rollup`;

DELETE grant_row
FROM `hr_role_grants` AS grant_row
INNER JOIN `hr_role_grant_scope_rollup` AS rollup
    ON grant_row.`user_id` = rollup.`user_id`
    AND grant_row.`role_id` = rollup.`role_id`
WHERE grant_row.`id` <> rollup.`keep_id`;

UPDATE `hr_role_grants` AS grant_row
INNER JOIN `hr_role_grant_scope_rollup` AS rollup ON grant_row.`id` = rollup.`keep_id`
SET grant_row.`active` = rollup.`active_value`;

DROP TEMPORARY TABLE `hr_role_grant_scope_rollup`;

ALTER TABLE `hr_role_grants`
    DROP CHECK `hr_role_grants_scope_chk`,
    DROP INDEX `hr_role_grants_scope_kind_scope_id_active_idx`,
    DROP INDEX `hr_role_grants_user_id_role_id_scope_kind_scope_id_key`,
    DROP COLUMN `scope_kind`,
    DROP COLUMN `scope_id`,
    ADD UNIQUE INDEX `hr_role_grants_user_id_role_id_key` (`user_id`, `role_id`),
    ADD INDEX `hr_role_grants_role_id_active_idx` (`role_id`, `active`);
