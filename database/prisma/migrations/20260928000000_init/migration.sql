-- CreateTable
CREATE TABLE `regions` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `stores` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_code` VARCHAR(50) NOT NULL,
    `store_name` VARCHAR(100) NOT NULL,
    `brand_name` VARCHAR(100) NOT NULL DEFAULT '米熊',
    `region_id` BIGINT NULL,
    `external_store_code` VARCHAR(100) NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `stores_store_code_key`(`store_code`),
    UNIQUE INDEX `stores_external_store_code_key`(`external_store_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(100) NOT NULL,
    `mobile` VARCHAR(30) NULL,
    `openid` VARCHAR(100) NULL,
    `role` ENUM('ADMIN', 'REGION_MANAGER', 'STORE_MANAGER') NOT NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_mobile_key`(`mobile`),
    UNIQUE INDEX `users_openid_key`(`openid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_stores` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NOT NULL,
    `store_id` BIGINT NOT NULL,

    UNIQUE INDEX `user_stores_user_id_store_id_key`(`user_id`, `store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_categories` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `brand_code` VARCHAR(50) NULL,
    `category_code` VARCHAR(50) NOT NULL,
    `category_name` VARCHAR(100) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `product_categories_brand_code_category_code_key`(`brand_code`, `category_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `products` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `external_product_code` VARCHAR(100) NOT NULL,
    `product_name` VARCHAR(200) NOT NULL,
    `category_id` BIGINT NOT NULL,
    `sale_price` DECIMAL(12, 2) NULL,
    `theoretical_cost` DECIMAL(12, 2) NULL,
    `status` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `products_external_product_code_key`(`external_product_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_periods` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `period_code` VARCHAR(30) NOT NULL,
    `period_name` VARCHAR(50) NOT NULL,
    `start_time` CHAR(5) NOT NULL,
    `end_time` CHAR(5) NOT NULL,
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `status` BOOLEAN NOT NULL DEFAULT true,

    UNIQUE INDEX `business_periods_period_code_key`(`period_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `power_calculation_configs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NULL,
    `mode` ENUM('SUM_COMPONENTS', 'MANUAL_TOTAL') NOT NULL DEFAULT 'SUM_COMPONENTS',
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `power_calculation_configs_store_id_key`(`store_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_sales` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `total_sales` DECIMAL(12, 2) NOT NULL,
    `total_customer_count` INTEGER NOT NULL,
    `dine_in_sales` DECIMAL(12, 2) NOT NULL,
    `dine_in_customer_count` INTEGER NOT NULL,
    `delivery_sales` DECIMAL(12, 2) NOT NULL,
    `delivery_order_count` INTEGER NOT NULL,
    `finalized` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_sales_store_id_business_date_key`(`store_id`, `business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sales_periods` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `period_code` VARCHAR(30) NOT NULL,
    `period_name` VARCHAR(50) NOT NULL,
    `sales_amount` DECIMAL(12, 2) NOT NULL,
    `customer_count` INTEGER NOT NULL,

    UNIQUE INDEX `sales_periods_store_id_business_date_period_code_key`(`store_id`, `business_date`, `period_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_buy_sales` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `platform_code` VARCHAR(50) NOT NULL,
    `platform_name` VARCHAR(100) NOT NULL,
    `sales_amount` DECIMAL(12, 2) NOT NULL,
    `customer_count` INTEGER NOT NULL,

    UNIQUE INDEX `group_buy_sales_store_id_business_date_platform_code_key`(`store_id`, `business_date`, `platform_code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `product_daily_sales` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `product_id` BIGINT NOT NULL,
    `category_id` BIGINT NOT NULL,
    `quantity` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `sales_amount` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `product_daily_sales_store_id_business_date_product_id_key`(`store_id`, `business_date`, `product_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `store_daily_inputs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `kitchen_power` DECIMAL(12, 2) NULL,
    `dining_power` DECIMAL(12, 2) NULL,
    `full_day_power` DECIMAL(12, 2) NULL,
    `air_condition_power` DECIMAL(12, 2) NULL,
    `total_power` DECIMAL(12, 2) NULL,
    `water_usage` DECIMAL(12, 2) NULL,
    `labor_hours` DECIMAL(12, 2) NULL,
    `addon_customer_count` INTEGER NULL,
    `combo_customer_count` INTEGER NULL,
    `remark` TEXT NULL,
    `status` ENUM('DRAFT', 'SUBMITTED', 'LOCKED') NOT NULL DEFAULT 'DRAFT',
    `submitted_by` BIGINT NULL,
    `submitted_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `store_daily_inputs_store_id_business_date_key`(`store_id`, `business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `daily_report_states` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `status` ENUM('OPEN', 'SUBMITTED', 'VERIFIED', 'LOCKED') NOT NULL DEFAULT 'OPEN',
    `verified_by` BIGINT NULL,
    `verified_at` DATETIME(3) NULL,
    `locked_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `daily_report_states_store_id_business_date_key`(`store_id`, `business_date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `api_sync_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `store_id` BIGINT NOT NULL,
    `business_date` DATE NOT NULL,
    `api_type` VARCHAR(50) NOT NULL,
    `status` ENUM('RUNNING', 'SUCCESS', 'FAILED') NOT NULL,
    `request_payload` LONGTEXT NULL,
    `response_payload` LONGTEXT NULL,
    `error_message` TEXT NULL,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    INDEX `api_sync_logs_store_id_business_date_api_type_idx`(`store_id`, `business_date`, `api_type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `user_id` BIGINT NULL,
    `entity_type` VARCHAR(50) NOT NULL,
    `entity_id` BIGINT NOT NULL,
    `action` VARCHAR(50) NOT NULL,
    `before_data` JSON NULL,
    `after_data` JSON NULL,
    `reason` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `stores` ADD CONSTRAINT `stores_region_id_fkey` FOREIGN KEY (`region_id`) REFERENCES `regions`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_stores` ADD CONSTRAINT `user_stores_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_stores` ADD CONSTRAINT `user_stores_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `products` ADD CONSTRAINT `products_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_sales` ADD CONSTRAINT `daily_sales_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sales_periods` ADD CONSTRAINT `sales_periods_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_buy_sales` ADD CONSTRAINT `group_buy_sales_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_daily_sales` ADD CONSTRAINT `product_daily_sales_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_daily_sales` ADD CONSTRAINT `product_daily_sales_product_id_fkey` FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `product_daily_sales` ADD CONSTRAINT `product_daily_sales_category_id_fkey` FOREIGN KEY (`category_id`) REFERENCES `product_categories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_daily_inputs` ADD CONSTRAINT `store_daily_inputs_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `store_daily_inputs` ADD CONSTRAINT `store_daily_inputs_submitted_by_fkey` FOREIGN KEY (`submitted_by`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `daily_report_states` ADD CONSTRAINT `daily_report_states_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `api_sync_logs` ADD CONSTRAINT `api_sync_logs_store_id_fkey` FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
