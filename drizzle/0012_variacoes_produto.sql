ALTER TABLE `products` ADD `parentId` int;--> statement-breakpoint
ALTER TABLE `products` ADD `modelName` varchar(512);--> statement-breakpoint
ALTER TABLE `products` ADD `attributes` text;--> statement-breakpoint
CREATE INDEX `products_parentId_idx` ON `products` (`parentId`);