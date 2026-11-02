CREATE TABLE `appointments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`type` enum('delivery','technical_visit','installation') NOT NULL,
	`status` enum('scheduled','done','cancelled') NOT NULL DEFAULT 'scheduled',
	`quoteId` int,
	`clientId` int,
	`clientName` varchar(240) NOT NULL,
	`phone` varchar(40),
	`address` text,
	`scheduledAt` timestamp NOT NULL,
	`durationMinutes` int NOT NULL DEFAULT 60,
	`responsible` varchar(240),
	`notes` text,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appointments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `quoteItemDeliveries` MODIFY COLUMN `productId` int;--> statement-breakpoint
ALTER TABLE `quotes` ADD `approvedAt` timestamp;--> statement-breakpoint
CREATE INDEX `appointments_scheduledAt_idx` ON `appointments` (`scheduledAt`);--> statement-breakpoint
UPDATE `quotes` SET `approvedAt` = `updatedAt`, `updatedAt` = `updatedAt` WHERE `status` = 'approved';