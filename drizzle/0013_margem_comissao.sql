CREATE TABLE `commissionPayments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`professional` varchar(240) NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`paidAt` timestamp NOT NULL,
	`notes` varchar(500),
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `commissionPayments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `professionals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(240) NOT NULL,
	`commissionPercent` decimal(5,2),
	`phone` varchar(40),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `professionals_id` PRIMARY KEY(`id`),
	CONSTRAINT `professionals_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
ALTER TABLE `products` ADD `costPrice` decimal(12,2);--> statement-breakpoint
ALTER TABLE `quoteItems` ADD `unitCost` decimal(12,2);--> statement-breakpoint
ALTER TABLE `quotes` ADD `sellerUserId` int;--> statement-breakpoint
ALTER TABLE `quotes` ADD `commissionPercent` decimal(5,2);--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `maxDiscountPercent` decimal(5,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `minMarginPercent` decimal(5,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `defaultCommissionPercent` decimal(5,2) DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX `commissionPayments_professional_idx` ON `commissionPayments` (`professional`);--> statement-breakpoint
UPDATE `quotes` q JOIN (SELECT `entityId`, MIN(`userId`) AS `userId` FROM `activityLog` WHERE `action` = 'quote.create' AND `entityType` = 'quote' AND `userId` IS NOT NULL GROUP BY `entityId`) a ON a.`entityId` = q.`id` SET q.`sellerUserId` = a.`userId`, q.`updatedAt` = q.`updatedAt`;
