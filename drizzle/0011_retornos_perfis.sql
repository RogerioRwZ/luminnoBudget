ALTER TABLE `users` MODIFY COLUMN `role` enum('user','admin','sales','stock','finance') NOT NULL DEFAULT 'user';--> statement-breakpoint
ALTER TABLE `quotes` ADD `followUpAt` timestamp;--> statement-breakpoint
ALTER TABLE `quotes` ADD `lostReason` enum('price','deadline','competitor','postponed','product','no_response','other');--> statement-breakpoint
ALTER TABLE `quotes` ADD `lostNotes` varchar(500);--> statement-breakpoint
ALTER TABLE `storeSettings` ADD `followUpDays` int DEFAULT 3 NOT NULL;--> statement-breakpoint
UPDATE `quotes` SET `followUpAt` = DATE_ADD(`updatedAt`, INTERVAL 3 DAY), `updatedAt` = `updatedAt` WHERE `status` = 'open';