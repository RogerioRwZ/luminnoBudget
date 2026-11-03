CREATE TABLE `stockLoanItems` (
	`id` int AUTO_INCREMENT NOT NULL,
	`loanId` int NOT NULL,
	`productId` int NOT NULL,
	`shortDescription` varchar(512) NOT NULL,
	`quantity` decimal(12,2) NOT NULL,
	`returnedQuantity` decimal(12,2) NOT NULL DEFAULT '0',
	`soldQuantity` decimal(12,2) NOT NULL DEFAULT '0',
	`lostQuantity` decimal(12,2) NOT NULL DEFAULT '0',
	CONSTRAINT `stockLoanItems_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stockLoans` (
	`id` int AUTO_INCREMENT NOT NULL,
	`borrowerName` varchar(240) NOT NULL,
	`borrowerKind` enum('client','professional','other') NOT NULL DEFAULT 'client',
	`phone` varchar(40),
	`quoteId` int,
	`notes` text,
	`loanedAt` timestamp NOT NULL DEFAULT (now()),
	`dueDate` timestamp NOT NULL,
	`closedAt` timestamp,
	`createdByUserId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stockLoans_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `stockMovements` MODIFY COLUMN `type` enum('entry','delivery','adjustment','return','loan_out','loan_return') NOT NULL;--> statement-breakpoint
CREATE INDEX `stockLoanItems_loanId_idx` ON `stockLoanItems` (`loanId`);--> statement-breakpoint
CREATE INDEX `stockLoans_dueDate_idx` ON `stockLoans` (`dueDate`);