-- 1. LMS platforms (one Canvas registration today, from env vars)
CREATE TABLE IF NOT EXISTS `lti_platform` (
  `id` INT(11) NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(255) NOT NULL DEFAULT 'Canvas LMS',
  `issuer` VARCHAR(255) NOT NULL,
  `client_id` VARCHAR(255) NOT NULL,
  `deployment_id` VARCHAR(255) NOT NULL,
  `auth_login_url` VARCHAR(500) NOT NULL,
  `auth_token_url` VARCHAR(500) NOT NULL,
  `token_audience` VARCHAR(500) DEFAULT NULL,
  `key_set_url` VARCHAR(500) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_issuer_client_deployment` (`issuer`, `client_id`, `deployment_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Durable experience mapping: issuer + deployment id + resource link id -> Vii quest id
CREATE TABLE IF NOT EXISTS `lti_resource_link` (
  `platform_id` INT(11) NOT NULL,
  `deployment_id` VARCHAR(255) NOT NULL,
  `resource_link_id` VARCHAR(255) NOT NULL,
  `quest_id` INT(11) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`platform_id`, `deployment_id`, `resource_link_id`),
  CONSTRAINT `fk_lti_resource_platform` FOREIGN KEY (`platform_id`) REFERENCES `lti_platform` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. OIDC login transactions (single use, minutes)
CREATE TABLE IF NOT EXISTS `lti_login_state` (
  `state` VARCHAR(128) NOT NULL,
  `nonce` VARCHAR(128) NOT NULL,
  `platform_id` INT(11) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`state`),
  KEY `idx_login_state_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Launch sessions (hours). The launch_ref is what Vii stores with an attempt.
CREATE TABLE IF NOT EXISTS `lti_launch_session` (
  `launch_ref` VARCHAR(64) NOT NULL,
  `status_token` VARCHAR(64) NOT NULL,
  `platform_id` INT(11) NOT NULL,
  `deployment_id` VARCHAR(255) NOT NULL,
  `resource_link_id` VARCHAR(255) DEFAULT NULL,
  `sub` VARCHAR(255) NOT NULL,                   -- opaque Canvas user id (LTI 1.3 `sub`)
  `role` ENUM('student','instructor') NOT NULL,
  `quest_id` INT(11) DEFAULT NULL,
  `vault_username` VARCHAR(255) DEFAULT NULL,    -- derived from sub
  `lineitem_url` VARCHAR(1000) DEFAULT NULL,     -- AGS line item from the launch
  `nrps_url` VARCHAR(1000) DEFAULT NULL,         -- NRPS memberships URL from the launch
  `sent_attempt_ids` TEXT DEFAULT NULL,          -- JSON array of Vii attempt ids already sent (no scores)
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`launch_ref`),
  UNIQUE KEY `idx_session_status_token` (`status_token`),
  KEY `idx_session_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Single-use launch codes shown in the QR code (minutes)
CREATE TABLE IF NOT EXISTS `lti_launch_code` (
  `code` VARCHAR(128) NOT NULL,
  `launch_ref` VARCHAR(64) NOT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`code`),
  CONSTRAINT `fk_lti_code_session` FOREIGN KEY (`launch_ref`) REFERENCES `lti_launch_session` (`launch_ref`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Deep Linking transactions (single use, minutes)
CREATE TABLE IF NOT EXISTS `lti_deep_link_tx` (
  `id` VARCHAR(64) NOT NULL,
  `platform_id` INT(11) NOT NULL,
  `deployment_id` VARCHAR(255) NOT NULL,
  `return_url` VARCHAR(1000) NOT NULL,
  `data` TEXT DEFAULT NULL,
  `expires_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example platform registration (fill in; do NOT commit real values):
-- INSERT INTO `lti_platform` (`issuer`, `client_id`, `deployment_id`, `auth_login_url`, `auth_token_url`, `key_set_url`)
-- VALUES ('https://canvas.instructure.com', '<client id>', '<deployment id>',
--         'https://<canvas-host>/api/lti/authorize_redirect', 'https://<canvas-host>/login/oauth2/token',
--         'https://<canvas-host>/api/lti/security/jwks');
