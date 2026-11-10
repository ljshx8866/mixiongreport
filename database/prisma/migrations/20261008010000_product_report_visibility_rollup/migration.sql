ALTER TABLE `products`
  ADD COLUMN `report_visible` TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN `report_product_id` BIGINT NULL;

CREATE INDEX `products_report_product_id_idx` ON `products`(`report_product_id`);

ALTER TABLE `products`
  ADD CONSTRAINT `products_report_product_id_fkey`
  FOREIGN KEY (`report_product_id`) REFERENCES `products`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
