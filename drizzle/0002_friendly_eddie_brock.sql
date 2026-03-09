CREATE TABLE `trade_log` (
	`id` int AUTO_INCREMENT NOT NULL,
	`signalAction` varchar(32) NOT NULL,
	`asset` varchar(16) NOT NULL,
	`tradeType` enum('buy','sell') NOT NULL,
	`price` decimal(20,8) NOT NULL,
	`notes` text,
	`executedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trade_log_id` PRIMARY KEY(`id`)
);
