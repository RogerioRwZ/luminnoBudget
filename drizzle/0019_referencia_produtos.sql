ALTER TABLE `products` ADD `reference` varchar(64);--> statement-breakpoint
UPDATE `products` SET `reference` = `code` WHERE `reference` IS NULL;--> statement-breakpoint
UPDATE `products` AS `p` JOIN (SELECT `code` FROM `products` GROUP BY `code` HAVING COUNT(*) > 1) AS `repeated` ON `repeated`.`code` = `p`.`code` SET `p`.`reference` = CONCAT(`p`.`code`, '-', `p`.`id`);--> statement-breakpoint
ALTER TABLE `products` ADD CONSTRAINT `products_reference_unique` UNIQUE(`reference`);
