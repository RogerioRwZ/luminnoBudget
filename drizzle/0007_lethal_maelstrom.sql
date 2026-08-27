CREATE TABLE `financePayments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`receivableId` int NOT NULL,
	`type` enum('receipt','reversal') NOT NULL,
	`amount` decimal(12,2) NOT NULL,
	`paymentMethod` enum('pix','cash','credit_card','debit_card','bank_transfer','boleto','other') NOT NULL DEFAULT 'other',
	`paidAt` timestamp NOT NULL DEFAULT (now()),
	`reference` varchar(120),
	`notes` text,
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `financePayments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `financeReceivables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`quoteId` int,
	`clientId` int,
	`clientName` varchar(240) NOT NULL,
	`description` varchar(512) NOT NULL,
	`installmentNumber` int NOT NULL DEFAULT 1,
	`installmentCount` int NOT NULL DEFAULT 1,
	`originalAmount` decimal(12,2) NOT NULL,
	`dueDate` timestamp NOT NULL,
	`status` enum('open','partial','paid','cancelled') NOT NULL DEFAULT 'open',
	`createdByUserId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `financeReceivables_id` PRIMARY KEY(`id`)
);
