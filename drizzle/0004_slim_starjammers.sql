CREATE TABLE `agent_access_token` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`name` text DEFAULT 'Finora skill' NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_access_token_hash_idx` ON `agent_access_token` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_access_token_user_idx` ON `agent_access_token` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_auth_request` (
	`id` text PRIMARY KEY NOT NULL,
	`device_code_hash` text NOT NULL,
	`user_code` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`user_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`approved_at` integer,
	`exchanged_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_auth_request_device_idx` ON `agent_auth_request` (`device_code_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_auth_request_user_code_idx` ON `agent_auth_request` (`user_code`);