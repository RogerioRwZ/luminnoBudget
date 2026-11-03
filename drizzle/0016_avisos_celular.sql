CREATE TABLE `appKeys` (
	`name` varchar(64) NOT NULL,
	`value` text NOT NULL,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `appKeys_name` PRIMARY KEY(`name`)
);
--> statement-breakpoint
CREATE TABLE `pushSubscriptions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`endpointHash` varchar(64) NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` varchar(160) NOT NULL,
	`auth` varchar(64) NOT NULL,
	`userAgent` varchar(255),
	`lastDailyAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `pushSubscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `pushSubscriptions_endpointHash_unique` UNIQUE(`endpointHash`)
);
--> statement-breakpoint
CREATE INDEX `pushSubscriptions_userId_idx` ON `pushSubscriptions` (`userId`);