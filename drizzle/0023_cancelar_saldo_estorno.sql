CREATE TABLE `quoteItemCancellations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`quoteItemId` int NOT NULL,
	`productId` int,
	`quantity` decimal(12,2) NOT NULL,
	`reason` text NOT NULL,
	`createdByUserId` int,
	`cancelledAt` timestamp NOT NULL DEFAULT (now()),
	`undoneAt` timestamp,
	`undoneByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quoteItemCancellations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `quoteItemDeliveries` ADD `reversedAt` timestamp;--> statement-breakpoint
ALTER TABLE `quoteItemDeliveries` ADD `reversalReason` text;--> statement-breakpoint
ALTER TABLE `quoteItemDeliveries` ADD `reversedByUserId` int;--> statement-breakpoint
ALTER TABLE `quoteItemDeliveries` ADD `reversalMovementId` int;--> statement-breakpoint
CREATE INDEX `quoteItemCancellations_quoteId_idx` ON `quoteItemCancellations` (`quoteId`);--> statement-breakpoint
CREATE INDEX `quoteItemCancellations_quoteItemId_idx` ON `quoteItemCancellations` (`quoteItemId`);