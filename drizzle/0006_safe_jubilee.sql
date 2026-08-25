CREATE TABLE `quotePdfHistory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`createdByUserId` int NOT NULL,
	`fileName` varchar(180) NOT NULL,
	`storageKey` varchar(255) NOT NULL,
	`fileSize` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `quotePdfHistory_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotePdfHistory_storageKey_unique` UNIQUE(`storageKey`)
);
