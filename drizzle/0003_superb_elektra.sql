CREATE TABLE `google_sheet_connection` (
	`user_id` text PRIMARY KEY NOT NULL,
	`spreadsheet_id` text NOT NULL,
	`spreadsheet_url` text NOT NULL,
	`name` text NOT NULL,
	`folder_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
