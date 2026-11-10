ALTER TABLE `products`
  ADD COLUMN `report_category_id` BIGINT NULL;

CREATE INDEX `products_report_category_id_idx` ON `products`(`report_category_id`);

ALTER TABLE `products`
  ADD CONSTRAINT `products_report_category_id_fkey`
  FOREIGN KEY (`report_category_id`) REFERENCES `product_categories`(`id`)
  ON DELETE SET NULL ON UPDATE CASCADE;
