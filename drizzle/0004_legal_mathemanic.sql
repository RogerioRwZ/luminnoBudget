CREATE TABLE `quoteItemReservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`quoteItemId` int NOT NULL,
	`productId` int NOT NULL,
	`reservedQuantity` decimal(12,2) NOT NULL,
	`reservedAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quoteItemReservations_id` PRIMARY KEY(`id`),
	CONSTRAINT `quoteItemReservations_quoteItemId_unique` UNIQUE(`quoteItemId`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `supplierName` varchar(240);