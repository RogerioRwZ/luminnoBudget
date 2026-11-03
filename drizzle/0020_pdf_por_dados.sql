ALTER TABLE `quotePdfHistory` MODIFY COLUMN `storageKey` varchar(255);--> statement-breakpoint
ALTER TABLE `quotePdfHistory` ADD `snapshot` mediumtext;