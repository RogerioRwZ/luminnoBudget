ALTER TABLE `financePayments` MODIFY COLUMN `paymentMethod` enum('pix','cash','credit_card','debit_card','bank_transfer','boleto','store_credit','other') NOT NULL DEFAULT 'other';--> statement-breakpoint
ALTER TABLE `financePayments` ADD `feeAmount` decimal(12,2);--> statement-breakpoint
ALTER TABLE `financeReceivables` ADD `paymentMethod` enum('pix','cash','credit_card','debit_card','bank_transfer','boleto','store_credit','other');--> statement-breakpoint
ALTER TABLE `quotes` ADD `paymentPlan` text;--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `cardFees` text;