CREATE TABLE `suppliers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(240) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `suppliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `suppliers_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
-- Lista inicial: os fornecedores que já estão nos produtos.
INSERT IGNORE INTO `suppliers` (`name`) SELECT DISTINCT TRIM(`supplierName`) FROM `products` WHERE TRIM(COALESCE(`supplierName`, '')) <> '';
--> statement-breakpoint
-- Horários gravados pelo padrão do banco: com o MySQL fora de UTC, foram lidos
-- com a diferença do fuso. Em servidor UTC o deslocamento é zero e nada muda.
UPDATE `activityLog` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `afterSalesCases` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `openedAt` = `openedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `appKeys` SET `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `appointments` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `clients` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `commissionPayments` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `financePayments` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `financeReceivables` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `internalComments` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `messageTemplates` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `products` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `professionals` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `pushSubscriptions` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quoteAttachments` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quoteItemCancellations` SET `cancelledAt` = `cancelledAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quoteItemDeliveries` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quoteItemReservations` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `reservedAt` = `reservedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quotePdfHistory` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quoteVersions` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `quotes` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `stockLoans` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `loanedAt` = `loanedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `stockMovements` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `storeSettings` SET `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
--> statement-breakpoint
UPDATE `users` SET `createdAt` = `createdAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND, `updatedAt` = `updatedAt` - INTERVAL TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) SECOND WHERE TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) <> 0;
