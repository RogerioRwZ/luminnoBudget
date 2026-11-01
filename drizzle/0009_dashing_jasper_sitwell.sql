CREATE TABLE `activityLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int,
	`userName` varchar(240),
	`action` varchar(64) NOT NULL,
	`entityType` varchar(32) NOT NULL,
	`entityId` int,
	`summary` varchar(512) NOT NULL,
	`details` text,
	`ip` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activityLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `pixCity` varchar(60);--> statement-breakpoint
CREATE INDEX `activityLog_createdAt_idx` ON `activityLog` (`createdAt`);--> statement-breakpoint
CREATE INDEX `activityLog_entity_idx` ON `activityLog` (`entityType`,`entityId`);