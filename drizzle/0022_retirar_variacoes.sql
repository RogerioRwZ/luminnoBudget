UPDATE `products` AS `model` JOIN (SELECT DISTINCT `parentId` FROM `products` WHERE `parentId` IS NOT NULL) AS `family` ON `family`.`parentId` = `model`.`id` SET `model`.`active` = false, `model`.`reorderPoint` = '0.00' WHERE `model`.`parentId` IS NULL AND (`model`.`attributes` IS NULL OR `model`.`attributes` IN ('', '{}')) AND `model`.`stockQuantity` <= 0;--> statement-breakpoint
DROP INDEX `products_parentId_idx` ON `products`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `parentId`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `modelName`;--> statement-breakpoint
ALTER TABLE `products` DROP COLUMN `attributes`;
