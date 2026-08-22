CREATE TABLE `quoteItemDeliveries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`quoteItemId` int NOT NULL,
	`productId` int NOT NULL,
	`clientName` varchar(240),
	`deliveredQuantity` decimal(12,2) NOT NULL,
	`deliveredAt` timestamp NOT NULL DEFAULT (now()),
	`responsible` varchar(240),
	`notes` text,
	`stockMovementId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quoteItemDeliveries_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stockMovements` (
	`id` int AUTO_INCREMENT NOT NULL,
	`productId` int NOT NULL,
	`type` enum('entry','delivery','adjustment','return') NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`beforeQuantity` decimal(12,2) NOT NULL,
	`afterQuantity` decimal(12,2) NOT NULL,
	`quoteId` int,
	`quoteItemId` int,
	`clientName` varchar(240),
	`responsible` varchar(240),
	`notes` text,
	`occurredAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `stockMovements_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `stockQuantity` decimal(12,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `reorderPoint` decimal(12,2) DEFAULT '0' NOT NULL;