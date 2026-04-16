CREATE DATABASE IF NOT EXISTS `fanshi_video_db`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `fanshi_video_db`;

CREATE TABLE IF NOT EXISTS `projects` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT UNSIGNED NULL COMMENT 'Reserved for future user table integration',
  `name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `status` ENUM('draft', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'draft',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `projects_user_id_idx` (`user_id`),
  KEY `projects_status_idx` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `videos` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `project_id` INT UNSIGNED NOT NULL,
  `filename` VARCHAR(255) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `duration` INT UNSIGNED NULL,
  `file_size` BIGINT UNSIGNED NULL,
  `status` ENUM('uploaded', 'analyzing', 'analyzed', 'failed') NOT NULL DEFAULT 'uploaded',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `videos_project_id_idx` (`project_id`),
  KEY `videos_status_idx` (`status`),
  CONSTRAINT `videos_project_id_fkey`
    FOREIGN KEY (`project_id`) REFERENCES `projects` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `analyses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `video_id` INT UNSIGNED NOT NULL,
  `plot` LONGTEXT NULL,
  `characters` JSON NULL,
  `backgrounds` JSON NULL,
  `time_anchors` JSON NULL,
  `gemini_response` LONGTEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `analyses_video_id_unique` (`video_id`),
  CONSTRAINT `analyses_video_id_fkey`
    FOREIGN KEY (`video_id`) REFERENCES `videos` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `segments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `video_id` INT UNSIGNED NOT NULL,
  `segment_index` INT UNSIGNED NOT NULL,
  `start_time` DECIMAL(10, 2) NOT NULL,
  `end_time` DECIMAL(10, 2) NOT NULL,
  `file_path` VARCHAR(500) NOT NULL,
  `analysis` JSON NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `segments_video_id_idx` (`video_id`),
  UNIQUE KEY `segments_video_id_segment_index_unique` (`video_id`, `segment_index`),
  CONSTRAINT `segments_video_id_fkey`
    FOREIGN KEY (`video_id`) REFERENCES `videos` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `segments_time_range_check`
    CHECK (`end_time` >= `start_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `generation_tasks` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `segment_id` INT UNSIGNED NOT NULL,
  `prompt` LONGTEXT NOT NULL,
  `optimized_prompt` LONGTEXT NULL,
  `status` ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  `result_url` VARCHAR(500) NULL,
  `progress` INT UNSIGNED NOT NULL DEFAULT 0,
  `error_message` TEXT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `generation_tasks_segment_id_idx` (`segment_id`),
  KEY `generation_tasks_status_idx` (`status`),
  CONSTRAINT `generation_tasks_segment_id_fkey`
    FOREIGN KEY (`segment_id`) REFERENCES `segments` (`id`)
    ON DELETE CASCADE
    ON UPDATE CASCADE,
  CONSTRAINT `generation_tasks_progress_check`
    CHECK (`progress` >= 0 AND `progress` <= 100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
