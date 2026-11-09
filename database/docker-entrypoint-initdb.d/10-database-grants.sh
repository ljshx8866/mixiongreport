#!/bin/sh
set -eu

: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"
: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
: "${MYSQL_MIGRATION_PASSWORD:?MYSQL_MIGRATION_PASSWORD is required}"

# MySQL's MYSQL_USER bootstrap grants ALL on the application schema. Replace
# that grant with DML-only privileges; schema changes use the separate
# report_migrator account through the opt-in Compose migration service.
mysql --protocol=socket -uroot -p"${MYSQL_ROOT_PASSWORD}" <<SQL
REVOKE ALL PRIVILEGES, GRANT OPTION FROM '${MYSQL_USER}'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE ON \`${MYSQL_DATABASE}\`.* TO '${MYSQL_USER}'@'%';
CREATE USER IF NOT EXISTS 'report_migrator'@'%' IDENTIFIED BY '${MYSQL_MIGRATION_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${MYSQL_DATABASE}\`.* TO 'report_migrator'@'%';
SQL
