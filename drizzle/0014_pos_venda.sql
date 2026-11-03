CREATE TABLE `afterSalesCases` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`quoteItemId` int NOT NULL,
	`productId` int,
	`clientName` varchar(240) NOT NULL,
	`productDescription` varchar(512) NOT NULL,
	`supplierName` varchar(240),
	`type` enum('return','exchange','warranty') NOT NULL,
	`reason` enum('defect','damaged','wrong_product','regret','installation','other') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`status` enum('open','supplier','resolved','rejected') NOT NULL DEFAULT 'open',
	`description` text,
	`resolution` text,
	`refundAmount` decimal(12,2),
	`restockMovementId` int,
	`replacementMovementId` int,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`dueDate` timestamp NOT NULL,
	`resolvedAt` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `afterSalesCases_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `warrantyMonths` int;--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `defaultWarrantyMonths` int DEFAULT 12 NOT NULL;--> statement-breakpoint
CREATE INDEX `afterSalesCases_quoteId_idx` ON `afterSalesCases` (`quoteId`);--> statement-breakpoint
CREATE INDEX `afterSalesCases_status_idx` ON `afterSalesCases` (`status`);