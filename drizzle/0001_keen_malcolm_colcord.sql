CREATE TABLE `clients` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(240) NOT NULL,
	`professional` varchar(240) NOT NULL,
	`document` varchar(32),
	`stateRegistration` varchar(32),
	`phone` varchar(40),
	`email` varchar(320),
	`address` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clients_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(64) NOT NULL,
	`shortDescription` varchar(512) NOT NULL,
	`fullDescription` text,
	`imageUrl` text,
	`imageKey` varchar(768),
	`unit` varchar(16) NOT NULL DEFAULT 'UN',
	`unitPrice` decimal(12,2) NOT NULL DEFAULT '0',
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `products_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quoteItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteRoomId` int NOT NULL,
	`productId` int,
	`code` varchar(64) NOT NULL,
	`shortDescription` varchar(512) NOT NULL,
	`imageUrl` text,
	`unit` varchar(16) NOT NULL DEFAULT 'UN',
	`quantity` decimal(12,2) NOT NULL DEFAULT '1',
	`unitPrice` decimal(12,2) NOT NULL DEFAULT '0',
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `quoteItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quoteRooms` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int NOT NULL,
	`name` varchar(160) NOT NULL,
	`sortOrder` int NOT NULL DEFAULT 0,
	CONSTRAINT `quoteRooms_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteNumber` int NOT NULL,
	`clientId` int,
	`clientName` varchar(240) NOT NULL,
	`professional` varchar(240) NOT NULL,
	`document` varchar(32),
	`stateRegistration` varchar(32),
	`phone` varchar(40),
	`address` text,
	`status` enum('draft','open','approved','lost') NOT NULL DEFAULT 'draft',
	`issueDate` timestamp NOT NULL DEFAULT (now()),
	`validUntil` timestamp,
	`discountMode` enum('percentage','fixed') NOT NULL DEFAULT 'percentage',
	`discountValue` decimal(12,2) NOT NULL DEFAULT '0',
	`shipping` decimal(12,2) NOT NULL DEFAULT '0',
	`pixDiscountMode` enum('percentage','fixed') NOT NULL DEFAULT 'percentage',
	`pixDiscountValue` decimal(12,2) NOT NULL DEFAULT '0',
	`installments` int NOT NULL DEFAULT 8,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `quotes_id` PRIMARY KEY(`id`),
	CONSTRAINT `quotes_quoteNumber_unique` UNIQUE(`quoteNumber`)
);
--> statement-breakpoint
CREATE TABLE `storeSettings` (
	`id` int NOT NULL,
	`companyName` varchar(256) NOT NULL DEFAULT 'Luminno Iluminação',
	`tradingName` varchar(256) NOT NULL DEFAULT 'Luminno',
	`logoUrl` text,
	`document` varchar(32),
	`address` text,
	`phone` varchar(40),
	`email` varchar(320),
	`pixKey` varchar(320),
	`pixRecipient` varchar(256),
	`defaultPixDiscountMode` enum('percentage','fixed') NOT NULL DEFAULT 'percentage',
	`defaultPixDiscountValue` decimal(12,2) NOT NULL DEFAULT '0',
	`defaultInstallments` int NOT NULL DEFAULT 8,
	`defaultTerms` text,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `storeSettings_id` PRIMARY KEY(`id`)
);
