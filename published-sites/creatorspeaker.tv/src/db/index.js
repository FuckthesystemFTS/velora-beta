const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");
const { Pool } = require("pg");

const meta = {
  driver: process.env.DATABASE_URL ? "pg" : "sqlite",
  pool: null,
  sqlite: null,
  initialized: false
};

const sqlitePath = path.join(__dirname, "..", "..", "data.sqlite");

function adaptPlaceholders(sql, params) {
  let index = 0;
  return sql.replace(/\?/g, () => {
    index += 1;
    return `$${index}`;
  });
}

function sqliteStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'active',
      permissions_json TEXT NOT NULL DEFAULT '{}',
      password_hash TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      area TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL DEFAULT 0,
      billing_type TEXT NOT NULL DEFAULT 'one_time',
      description TEXT NOT NULL,
      features_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_code TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      company_name TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_bank_transfer',
      bank_instructions TEXT NOT NULL,
      items_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS content_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      description TEXT,
      publication_date TEXT,
      status TEXT NOT NULL DEFAULT 'uploaded',
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stored_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_user_id INTEGER,
      purpose TEXT NOT NULL DEFAULT 'generic',
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'semplice',
      format TEXT NOT NULL DEFAULT '16:9',
      image_paths_json TEXT NOT NULL DEFAULT '[]',
      audio_path TEXT NOT NULL,
      output_path TEXT,
      credits_cost INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      error_message TEXT,
      refunded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_render_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      credits_cost INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      default_duration_seconds REAL NOT NULL DEFAULT 5,
      max_images INTEGER NOT NULL DEFAULT 10,
      max_upload_mb INTEGER NOT NULL DEFAULT 250,
      resolution TEXT NOT NULL DEFAULT '1280x720',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      feature_flags_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_job_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_job_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 5,
      caption TEXT NOT NULL DEFAULT '',
      transition TEXT NOT NULL DEFAULT 'none',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      amazon_keywords_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS offers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      category_id INTEGER,
      title TEXT NOT NULL,
      asin TEXT,
      image_url TEXT,
      product_url TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      normal_price_cents INTEGER,
      current_price_cents INTEGER NOT NULL,
      discount_percent INTEGER,
      prime_available INTEGER NOT NULL DEFAULT 0,
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'discovered',
      published_telegram_at TEXT,
      published_facebook_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'logged',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_platforms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      public_description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      max_users INTEGER NOT NULL DEFAULT 1,
      active_users_count INTEGER NOT NULL DEFAULT 0,
      price_per_user INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      duration_days INTEGER NOT NULL DEFAULT 30,
      platform_url TEXT NOT NULL DEFAULT '',
      login_url TEXT NOT NULL DEFAULT '',
      shared_login_email_encrypted TEXT NOT NULL DEFAULT '',
      shared_login_password_encrypted TEXT NOT NULL DEFAULT '',
      admin_private_notes_encrypted TEXT NOT NULL DEFAULT '',
      user_visible_instructions TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'waiting',
      payment_reference TEXT,
      payment_note TEXT,
      payment_received_at TEXT,
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      request_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT,
      user_visible_note TEXT,
      admin_private_note_encrypted TEXT NOT NULL DEFAULT '',
      activated_by_admin_id INTEGER,
      credentials_view_count INTEGER NOT NULL DEFAULT 0,
      last_credentials_viewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      assignment_id INTEGER,
      issue_type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      assignment_id INTEGER,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_admin_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER NOT NULL,
      user_id INTEGER,
      platform_id INTEGER,
      request_id INTEGER,
      assignment_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      alt_text TEXT,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'image',
      resource_type TEXT NOT NULL DEFAULT 'image',
      cloudinary_public_id TEXT,
      cloudinary_secure_url TEXT,
      cloudinary_format TEXT,
      cloudinary_folder TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_admin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS content_sections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      section_key TEXT NOT NULL,
      page_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT '',
      cta_url TEXT NOT NULL DEFAULT '',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      layout_type TEXT NOT NULL DEFAULT 'text',
      seo_title TEXT NOT NULL DEFAULT '',
      seo_description TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS service_packages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'custom',
      short_description TEXT NOT NULL DEFAULT '',
      long_description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      billing_type TEXT NOT NULL DEFAULT 'one_time',
      features_json TEXT NOT NULL DEFAULT '[]',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      is_featured INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      cta_label TEXT NOT NULL DEFAULT 'Richiedi attivazione',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS package_features (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      package_id INTEGER NOT NULL,
      feature_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS creator_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      role TEXT,
      bio TEXT,
      description TEXT,
      avatar_media_id INTEGER,
      cover_media_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_featured INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS speaker_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      topic TEXT,
      bio TEXT,
      description TEXT,
      avatar_media_id INTEGER,
      cover_media_id INTEGER,
      video_media_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_featured INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS brand_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      benefits_json TEXT NOT NULL DEFAULT '[]',
      cta_label TEXT NOT NULL DEFAULT 'Richiedi informazioni',
      cta_url TEXT NOT NULL DEFAULT '/richiedi-informazioni',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      group_name TEXT NOT NULL DEFAULT 'general',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS site_visit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT NOT NULL,
      page_type TEXT NOT NULL DEFAULT 'public',
      referrer_host TEXT,
      referrer_url TEXT,
      device_type TEXT NOT NULL DEFAULT 'desktop',
      visitor_hash TEXT NOT NULL,
      session_id TEXT,
      user_id INTEGER,
      is_authenticated INTEGER NOT NULL DEFAULT 0,
      status_code INTEGER NOT NULL DEFAULT 200,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];
}

function pgStatements() {
  return [
    `CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'admin',
      status TEXT NOT NULL DEFAULT 'active',
      permissions_json TEXT NOT NULL DEFAULT '{}',
      password_hash TEXT NOT NULL,
      must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      credits INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMP NOT NULL,
      used_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,
      area TEXT NOT NULL,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      price_cents INTEGER NOT NULL DEFAULT 0,
      billing_type TEXT NOT NULL DEFAULT 'one_time',
      description TEXT NOT NULL,
      features_json TEXT NOT NULL DEFAULT '[]',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_code TEXT NOT NULL UNIQUE,
      user_id INTEGER,
      customer_name TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      customer_phone TEXT,
      company_name TEXT,
      total_cents INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending_bank_transfer',
      bank_instructions TEXT NOT NULL,
      items_json TEXT NOT NULL DEFAULT '[]',
      notes TEXT,
      admin_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      package_id INTEGER NOT NULL,
      order_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS content_uploads (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      description TEXT,
      publication_date TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'uploaded',
      admin_notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stored_files (
      id SERIAL PRIMARY KEY,
      owner_user_id INTEGER,
      purpose TEXT NOT NULL DEFAULT 'generic',
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      data BYTEA NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_jobs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'semplice',
      format TEXT NOT NULL DEFAULT '16:9',
      image_paths_json TEXT NOT NULL DEFAULT '[]',
      audio_path TEXT NOT NULL,
      output_path TEXT,
      credits_cost INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'draft',
      error_message TEXT,
      refunded BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_render_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      credits_cost INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      default_duration_seconds REAL NOT NULL DEFAULT 5,
      max_images INTEGER NOT NULL DEFAULT 10,
      max_upload_mb INTEGER NOT NULL DEFAULT 250,
      resolution TEXT NOT NULL DEFAULT '1280x720',
      aspect_ratio TEXT NOT NULL DEFAULT '16:9',
      feature_flags_json TEXT NOT NULL DEFAULT '{}',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS video_job_images (
      id SERIAL PRIMARY KEY,
      video_job_id INTEGER NOT NULL,
      file_id INTEGER NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      duration_seconds REAL NOT NULL DEFAULT 5,
      caption TEXT NOT NULL DEFAULT '',
      transition TEXT NOT NULL DEFAULT 'none',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      amazon_keywords_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS offers (
      id SERIAL PRIMARY KEY,
      source TEXT NOT NULL,
      category_id INTEGER,
      title TEXT NOT NULL,
      asin TEXT,
      image_url TEXT,
      product_url TEXT NOT NULL,
      affiliate_url TEXT NOT NULL,
      normal_price_cents INTEGER,
      current_price_cents INTEGER NOT NULL,
      discount_percent INTEGER,
      prime_available BOOLEAN NOT NULL DEFAULT FALSE,
      score NUMERIC(10,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'discovered',
      published_telegram_at TIMESTAMP,
      published_facebook_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS notifications_log (
      id SERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      target TEXT NOT NULL,
      subject TEXT NOT NULL,
      body TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'logged',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_platforms (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      public_description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      max_users INTEGER NOT NULL DEFAULT 1,
      active_users_count INTEGER NOT NULL DEFAULT 0,
      price_per_user INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      duration_days INTEGER NOT NULL DEFAULT 30,
      platform_url TEXT NOT NULL DEFAULT '',
      login_url TEXT NOT NULL DEFAULT '',
      shared_login_email_encrypted TEXT NOT NULL DEFAULT '',
      shared_login_password_encrypted TEXT NOT NULL DEFAULT '',
      admin_private_notes_encrypted TEXT NOT NULL DEFAULT '',
      user_visible_instructions TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_requests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payment_status TEXT NOT NULL DEFAULT 'waiting',
      payment_reference TEXT,
      payment_note TEXT,
      payment_received_at TIMESTAMP,
      admin_note TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_assignments (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      request_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TIMESTAMP,
      user_visible_note TEXT,
      admin_private_note_encrypted TEXT NOT NULL DEFAULT '',
      activated_by_admin_id INTEGER,
      credentials_view_count INTEGER NOT NULL DEFAULT 0,
      last_credentials_viewed_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_issues (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      assignment_id INTEGER,
      issue_type TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_reply TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_access_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      platform_id INTEGER NOT NULL,
      assignment_id INTEGER,
      action TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscription_admin_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER NOT NULL,
      user_id INTEGER,
      platform_id INTEGER,
      request_id INTEGER,
      assignment_id INTEGER,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS media_assets (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      alt_text TEXT,
      description TEXT,
      type TEXT NOT NULL DEFAULT 'image',
      resource_type TEXT NOT NULL DEFAULT 'image',
      cloudinary_public_id TEXT,
      cloudinary_secure_url TEXT,
      cloudinary_format TEXT,
      cloudinary_folder TEXT,
      width INTEGER,
      height INTEGER,
      duration NUMERIC,
      bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_admin_id INTEGER,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS content_sections (
      id SERIAL PRIMARY KEY,
      section_key TEXT NOT NULL,
      page_key TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      subtitle TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '',
      cta_label TEXT NOT NULL DEFAULT '',
      cta_url TEXT NOT NULL DEFAULT '',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      layout_type TEXT NOT NULL DEFAULT 'text',
      seo_title TEXT NOT NULL DEFAULT '',
      seo_description TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS service_packages (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      category TEXT NOT NULL DEFAULT 'custom',
      short_description TEXT NOT NULL DEFAULT '',
      long_description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      billing_type TEXT NOT NULL DEFAULT 'one_time',
      features_json TEXT NOT NULL DEFAULT '[]',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      cta_label TEXT NOT NULL DEFAULT 'Richiedi attivazione',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS package_features (
      id SERIAL PRIMARY KEY,
      package_id INTEGER NOT NULL,
      feature_text TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS creator_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      role TEXT,
      bio TEXT,
      description TEXT,
      avatar_media_id INTEGER,
      cover_media_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS speaker_profiles (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      topic TEXT,
      bio TEXT,
      description TEXT,
      avatar_media_id INTEGER,
      cover_media_id INTEGER,
      video_media_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      is_featured BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS brand_services (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT,
      benefits_json TEXT NOT NULL DEFAULT '[]',
      cta_label TEXT NOT NULL DEFAULT 'Richiedi informazioni',
      cta_url TEXT NOT NULL DEFAULT '/richiedi-informazioni',
      media_asset_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS site_settings (
      id SERIAL PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      group_name TEXT NOT NULL DEFAULT 'general',
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      admin_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      details TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS site_visit_events (
      id SERIAL PRIMARY KEY,
      path TEXT NOT NULL,
      page_type TEXT NOT NULL DEFAULT 'public',
      referrer_host TEXT,
      referrer_url TEXT,
      device_type TEXT NOT NULL DEFAULT 'desktop',
      visitor_hash TEXT NOT NULL,
      session_id TEXT,
      user_id INTEGER,
      is_authenticated BOOLEAN NOT NULL DEFAULT FALSE,
      status_code INTEGER NOT NULL DEFAULT 200,
      user_agent TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];
}

async function initialize() {
  if (meta.initialized) {
    return meta;
  }

  if (meta.driver === "pg") {
    meta.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: String(process.env.DATABASE_URL || "").includes("localhost")
        ? false
        : { rejectUnauthorized: false }
    });
  } else {
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    meta.sqlite = new Database(sqlitePath);
    meta.sqlite.pragma("journal_mode = WAL");
  }

  await migrate();
  const { seedIfNeeded } = require("./seed");
  await seedIfNeeded();
  meta.initialized = true;
  return meta;
}

async function migrate() {
  const statements = meta.driver === "pg" ? pgStatements() : sqliteStatements();
  for (const statement of statements) {
    await run(statement);
  }
  await migrateCompat();
}

async function hasColumn(tableName, columnName) {
  if (meta.driver === "pg") {
    const row = await get(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = ? AND column_name = ?",
      [tableName, columnName]
    );
    return Boolean(row);
  }

  const rows = await all(`PRAGMA table_info(${tableName})`);
  return rows.some((row) => row.name === columnName);
}

async function ensureColumn(tableName, columnName, definition) {
  if (await hasColumn(tableName, columnName)) {
    return;
  }
  await run(`ALTER TABLE ${tableName} ADD COLUMN ${definition}`);
}

const defaultVideoProfiles = [
  {
    name: "Video Semplice",
    slug: "semplice",
    credits_cost: 3,
    description: "Montaggio automatico con durata fissa per immagine, pensato per contenuti rapidi",
    default_duration_seconds: 5,
    max_images: 10,
    max_upload_mb: 250,
    resolution: "1280x720",
    aspect_ratio: "16:9",
    feature_flags_json: JSON.stringify({
      customDurations: false,
      audioTrim: false,
      captions: false,
      transitions: false
    }),
    active: meta.driver === "pg" ? true : 1,
    sort_order: 10
  },
  {
    name: "Video Personalizzato",
    slug: "personalizzato",
    credits_cost: 6,
    description: "Durate personalizzabili e taglio audio per un controllo piu preciso",
    default_duration_seconds: 5,
    max_images: 10,
    max_upload_mb: 250,
    resolution: "1280x720",
    aspect_ratio: "16:9",
    feature_flags_json: JSON.stringify({
      customDurations: true,
      audioTrim: true,
      captions: false,
      transitions: false
    }),
    active: meta.driver === "pg" ? true : 1,
    sort_order: 20
  },
  {
    name: "Video Pro",
    slug: "pro",
    credits_cost: 10,
    description: "Controlli avanzati su durata, audio, formato e testo descrittivo delle scene",
    default_duration_seconds: 5,
    max_images: 10,
    max_upload_mb: 250,
    resolution: "1920x1080",
    aspect_ratio: "16:9",
    feature_flags_json: JSON.stringify({
      customDurations: true,
      audioTrim: true,
      captions: true,
      transitions: false
    }),
    active: meta.driver === "pg" ? true : 1,
    sort_order: 30
  },
  {
    name: "Video Studio",
    slug: "studio",
    credits_cost: 15,
    description: "Profilo completo per formati social, timeline dettagliata e regolazioni audio",
    default_duration_seconds: 5,
    max_images: 10,
    max_upload_mb: 250,
    resolution: "1920x1080",
    aspect_ratio: "16:9",
    feature_flags_json: JSON.stringify({
      customDurations: true,
      audioTrim: true,
      captions: true,
      transitions: true
    }),
    active: meta.driver === "pg" ? true : 1,
    sort_order: 40
  }
];

async function seedDefaultVideoProfiles() {
  for (const profile of defaultVideoProfiles) {
    const existing = await get("SELECT id FROM video_render_profiles WHERE slug = ?", [profile.slug]);
    if (!existing) {
      await insert("video_render_profiles", profile);
    }
  }
}

async function createOutreachTables() {
  const id = meta.driver === "pg" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const statements = [
    `CREATE TABLE IF NOT EXISTS outreach_searches (
      id ${id},
      created_by_user_id INTEGER,
      query TEXT NOT NULL DEFAULT '',
      sector TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      language TEXT NOT NULL DEFAULT 'it',
      requested_limit INTEGER NOT NULL DEFAULT 10,
      status TEXT NOT NULL DEFAULT 'draft',
      results_found INTEGER NOT NULL DEFAULT 0,
      websites_scanned INTEGER NOT NULL DEFAULT 0,
      emails_found INTEGER NOT NULL DEFAULT 0,
      emails_accepted INTEGER NOT NULL DEFAULT 0,
      emails_rejected INTEGER NOT NULL DEFAULT 0,
      search_provider TEXT NOT NULL DEFAULT 'google_cse',
      provider_query_json TEXT NOT NULL DEFAULT '{}',
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_businesses (
      id ${id},
      search_id INTEGER,
      business_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      province TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      website_url TEXT NOT NULL DEFAULT '',
      google_place_id TEXT,
      source_provider TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_contacts (
      id ${id},
      business_id INTEGER,
      search_id INTEGER,
      email TEXT NOT NULL DEFAULT '',
      normalized_email TEXT NOT NULL,
      email_domain TEXT NOT NULL DEFAULT '',
      contact_type TEXT NOT NULL DEFAULT 'generic_business',
      is_role_based INTEGER NOT NULL DEFAULT 0,
      is_personal_provider INTEGER NOT NULL DEFAULT 0,
      source_url TEXT NOT NULL DEFAULT '',
      source_page_title TEXT NOT NULL DEFAULT '',
      source_context TEXT NOT NULL DEFAULT '',
      validation_status TEXT NOT NULL DEFAULT 'unverified',
      approval_status TEXT NOT NULL DEFAULT 'pending_review',
      legal_basis_note TEXT NOT NULL DEFAULT '',
      consent_reference TEXT NOT NULL DEFAULT '',
      approved_by_user_id INTEGER,
      approved_at TEXT,
      last_contacted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_lists (
      id ${id},
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      contact_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_list_contacts (
      id ${id},
      list_id INTEGER NOT NULL,
      contact_id INTEGER NOT NULL,
      added_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_email_templates (
      id ${id},
      name TEXT NOT NULL,
      subject TEXT NOT NULL DEFAULT '',
      html_body TEXT NOT NULL DEFAULT '',
      text_body TEXT NOT NULL DEFAULT '',
      sender_name TEXT NOT NULL DEFAULT '',
      reply_to TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'presentazione',
      is_default INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      created_by_user_id INTEGER,
      updated_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_campaigns (
      id ${id},
      name TEXT NOT NULL,
      template_id INTEGER,
      list_id INTEGER,
      from_email TEXT NOT NULL DEFAULT '',
      from_name TEXT NOT NULL DEFAULT '',
      reply_to TEXT NOT NULL DEFAULT '',
      subject_override TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'draft',
      recipient_count INTEGER NOT NULL DEFAULT 0,
      approved_recipient_count INTEGER NOT NULL DEFAULT 0,
      sent_count INTEGER NOT NULL DEFAULT 0,
      delivered_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      unsubscribed_count INTEGER NOT NULL DEFAULT 0,
      daily_limit INTEGER NOT NULL DEFAULT 100,
      delay_seconds INTEGER NOT NULL DEFAULT 45,
      scheduled_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_by_user_id INTEGER,
      approved_by_admin_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_campaign_recipients (
      id ${id},
      campaign_id INTEGER NOT NULL,
      contact_id INTEGER,
      email TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      personalization_json TEXT NOT NULL DEFAULT '{}',
      message_id TEXT NOT NULL DEFAULT '',
      smtp_response TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      queued_at TEXT,
      sent_at TEXT,
      failed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_suppression_list (
      id ${id},
      email TEXT NOT NULL DEFAULT '',
      normalized_email TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT 'manual',
      source TEXT NOT NULL DEFAULT '',
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_unsubscribe_tokens (
      id ${id},
      contact_id INTEGER,
      campaign_id INTEGER,
      token_hash TEXT NOT NULL,
      used_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS outreach_audit_logs (
      id ${id},
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id INTEGER,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const statement of statements) {
    await run(statement);
  }

  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_contacts_normalized_email ON outreach_contacts (normalized_email)");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_list_contacts_unique ON outreach_list_contacts (list_id, contact_id)");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_suppression_unique ON outreach_suppression_list (normalized_email)");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_outreach_unsubscribe_token_hash ON outreach_unsubscribe_tokens (token_hash)");
  await run("CREATE INDEX IF NOT EXISTS idx_outreach_searches_status ON outreach_searches (status, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_outreach_campaign_recipients_status ON outreach_campaign_recipients (status, queued_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_outreach_campaign_recipients_campaign ON outreach_campaign_recipients (campaign_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_outreach_audit_created ON outreach_audit_logs (created_at)");

  const defaultTemplate = await get("SELECT id FROM outreach_email_templates WHERE is_default = ? LIMIT 1", [1]);
  if (!defaultTemplate) {
    await insert("outreach_email_templates", {
      name: "Presentazione CreatorSpeaker TV",
      subject: "Una proposta per {{business_name}}",
      html_body:
        "<p>Buongiorno,</p><p>sono {{sender_name}} di CreatorSpeaker TV. Vi contatto per presentarvi una piattaforma pensata per dare visibilita a creator, speaker, aziende e contenuti multimediali.</p><p>Se puo essere utile per {{business_name}}, potete rispondere direttamente a questa email.</p><p>Informativa privacy: {{privacy_url}}</p><p>Per non ricevere ulteriori comunicazioni: {{unsubscribe_url}}</p>",
      text_body:
        "Buongiorno,\nsono {{sender_name}} di CreatorSpeaker TV. Vi contatto per presentarvi una piattaforma pensata per dare visibilita a creator, speaker, aziende e contenuti multimediali.\n\nInformativa privacy: {{privacy_url}}\nPer non ricevere ulteriori comunicazioni: {{unsubscribe_url}}",
      sender_name: "CreatorSpeaker TV",
      reply_to: "service@creatorspeakertv.it",
      category: "presentazione",
      is_default: 1,
      status: "active",
      created_by_user_id: null,
      updated_by_user_id: null
    });
  }
}

async function createAffiliateDealsTables() {
  const id = meta.driver === "pg" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const boolDefault = meta.driver === "pg" ? "BOOLEAN NOT NULL DEFAULT FALSE" : "INTEGER NOT NULL DEFAULT 0";
  const boolTrueDefault = meta.driver === "pg" ? "BOOLEAN NOT NULL DEFAULT TRUE" : "INTEGER NOT NULL DEFAULT 1";
  const statements = [
    `CREATE TABLE IF NOT EXISTS affiliate_categories (
      id ${id},
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      emoji TEXT NOT NULL DEFAULT '',
      amazon_keywords_json TEXT NOT NULL DEFAULT '[]',
      amazon_category_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inactive',
      priority INTEGER NOT NULL DEFAULT 50,
      minimum_discount_percent INTEGER NOT NULL DEFAULT 20,
      minimum_deal_score INTEGER NOT NULL DEFAULT 65,
      max_results_per_search INTEGER NOT NULL DEFAULT 20,
      search_frequency_minutes INTEGER NOT NULL DEFAULT 60,
      telegram_enabled ${boolTrueDefault},
      facebook_enabled ${boolTrueDefault},
      daily_special_enabled ${boolTrueDefault},
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_products (
      id ${id},
      amazon_asin TEXT NOT NULL,
      marketplace TEXT NOT NULL DEFAULT 'www.amazon.it',
      source_type TEXT NOT NULL DEFAULT 'amazon',
      source_text TEXT NOT NULL DEFAULT '',
      source_post_url TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      brand TEXT NOT NULL DEFAULT '',
      category_id INTEGER,
      product_url TEXT NOT NULL DEFAULT '',
      affiliate_url TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      detail_page_url TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'EUR',
      availability TEXT NOT NULL DEFAULT '',
      prime_eligible ${boolDefault},
      rating REAL,
      review_count INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_price_observations (
      id ${id},
      product_id INTEGER NOT NULL,
      current_price INTEGER NOT NULL DEFAULT 0,
      reference_price INTEGER,
      list_price INTEGER,
      saving_amount INTEGER,
      saving_percent INTEGER,
      currency TEXT NOT NULL DEFAULT 'EUR',
      availability TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'internal',
      observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_offers (
      id ${id},
      product_id INTEGER NOT NULL,
      category_id INTEGER,
      current_price INTEGER NOT NULL DEFAULT 0,
      previous_price INTEGER,
      reference_price INTEGER,
      discount_percent INTEGER,
      deal_score REAL NOT NULL DEFAULT 0,
      price_history_score REAL NOT NULL DEFAULT 0,
      discount_score REAL NOT NULL DEFAULT 0,
      popularity_score REAL NOT NULL DEFAULT 0,
      category_score REAL NOT NULL DEFAULT 0,
      prime_eligible ${boolDefault},
      status TEXT NOT NULL DEFAULT 'detected',
      rejection_reason TEXT NOT NULL DEFAULT '',
      first_detected_at TEXT,
      last_detected_at TEXT,
      expires_at TEXT,
      approved_by_user_id INTEGER,
      approved_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_daily_specials (
      id ${id},
      offer_id INTEGER NOT NULL,
      selection_date TEXT NOT NULL,
      score REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'selected',
      facebook_publication_id INTEGER,
      facebook_post_url TEXT NOT NULL DEFAULT '',
      telegram_teaser_publication_id INTEGER,
      selected_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_channels (
      id ${id},
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      external_id TEXT NOT NULL DEFAULT '',
      public_url TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'inactive',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_post_templates (
      id ${id},
      name TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      post_type TEXT NOT NULL,
      category_id INTEGER,
      text_template TEXT NOT NULL DEFAULT '',
      button_label TEXT NOT NULL DEFAULT '',
      include_product_image ${boolTrueDefault},
      include_channel_logo ${boolDefault},
      include_price_disclaimer ${boolTrueDefault},
      include_affiliate_disclosure ${boolTrueDefault},
      status TEXT NOT NULL DEFAULT 'active',
      is_default ${boolDefault},
      created_by_user_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_publication_jobs (
      id ${id},
      offer_id INTEGER,
      daily_special_id INTEGER,
      channel_type TEXT NOT NULL,
      post_type TEXT NOT NULL,
      scheduled_at TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      external_post_id TEXT NOT NULL DEFAULT '',
      external_post_url TEXT NOT NULL DEFAULT '',
      rendered_text TEXT NOT NULL DEFAULT '',
      image_url TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      started_at TEXT,
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_scheduler_runs (
      id ${id},
      job_type TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      items_scanned INTEGER NOT NULL DEFAULT 0,
      offers_found INTEGER NOT NULL DEFAULT 0,
      jobs_created INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_settings (
      id ${id},
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT 'text',
      group_name TEXT NOT NULL DEFAULT 'general',
      updated_by_user_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_audit_logs (
      id ${id},
      user_id INTEGER,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL DEFAULT '',
      entity_id INTEGER,
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS affiliate_background_jobs (
      id ${id},
      job_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      unique_key TEXT NOT NULL DEFAULT '',
      payload_json TEXT NOT NULL DEFAULT '{}',
      run_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      locked_at TEXT,
      locked_by TEXT NOT NULL DEFAULT '',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 3,
      error_message TEXT NOT NULL DEFAULT '',
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const statement of statements) {
    await run(statement);
  }

  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_products_asin_marketplace ON affiliate_products (amazon_asin, marketplace)");
  await run("CREATE INDEX IF NOT EXISTS idx_affiliate_price_observations_product_observed ON affiliate_price_observations (product_id, observed_at)");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_daily_specials_selection_date ON affiliate_daily_specials (selection_date)");
  await run("CREATE INDEX IF NOT EXISTS idx_affiliate_offers_status_score ON affiliate_offers (status, deal_score, updated_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_affiliate_publication_jobs_status_scheduled ON affiliate_publication_jobs (status, scheduled_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_affiliate_scheduler_runs_type_created ON affiliate_scheduler_runs (job_type, created_at)");
  await run("CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliate_background_jobs_unique_key ON affiliate_background_jobs (unique_key)");
  await run("CREATE INDEX IF NOT EXISTS idx_affiliate_background_jobs_status_run ON affiliate_background_jobs (status, run_at)");

  const categorySeeds = [
    { name: "Smartphone", slug: "smartphone", emoji: "📱", status: "active", priority: 100, sort_order: 10, keywords: ["smartphone offerte amazon", "telefono android offerta"] },
    { name: "Accessori smartphone", slug: "accessori-smartphone", emoji: "🔌", status: "active", priority: 92, sort_order: 20, keywords: ["accessori smartphone amazon", "powerbank caricatore offerta"] },
    { name: "Tecnologia generale", slug: "tecnologia-generale", emoji: "💡", status: "active", priority: 88, sort_order: 30, keywords: ["tecnologia offerte amazon", "gadget tech offerta"] },
    { name: "Computer", slug: "computer", emoji: "💻", status: "active", priority: 95, sort_order: 40, keywords: ["computer portatile offerta amazon", "monitor pc offerta"] },
    { name: "Tablet", slug: "tablet", emoji: "📲", status: "active", priority: 85, sort_order: 50, keywords: ["tablet offerte amazon", "ipad android tablet offerta"] },
    { name: "Smartwatch", slug: "smartwatch", emoji: "⌚", status: "active", priority: 80, sort_order: 60, keywords: ["smartwatch offerte amazon", "watch sport offerta"] },
    { name: "Cuffie e audio", slug: "cuffie-e-audio", emoji: "🎧", status: "active", priority: 84, sort_order: 70, keywords: ["cuffie bluetooth offerta amazon", "speaker audio offerta"] },
    { name: "Casa smart", slug: "casa-smart", emoji: "🏠", status: "active", priority: 78, sort_order: 80, keywords: ["casa smart amazon offerte", "lampada smart presa wifi offerta"] },
    { name: "Piccoli elettrodomestici", slug: "piccoli-elettrodomestici", emoji: "🧺", status: "inactive", priority: 60, sort_order: 90, keywords: ["elettrodomestici piccoli amazon offerte"] },
    { name: "Libri", slug: "libri", emoji: "📚", status: "inactive", priority: 45, sort_order: 100, keywords: ["libri tecnologia amazon offerte"] },
    { name: "Orologi", slug: "orologi", emoji: "🕰️", status: "inactive", priority: 45, sort_order: 110, keywords: ["orologi amazon offerte"] },
    { name: "Accessori auto", slug: "accessori-auto", emoji: "🚗", status: "inactive", priority: 58, sort_order: 120, keywords: ["accessori auto amazon offerte"] },
    { name: "Accessori moto", slug: "accessori-moto", emoji: "🏍️", status: "inactive", priority: 52, sort_order: 130, keywords: ["accessori moto amazon offerte"] },
    { name: "Gaming", slug: "gaming", emoji: "🎮", status: "inactive", priority: 72, sort_order: 140, keywords: ["gaming amazon offerte", "console accessori gaming offerta"] },
    { name: "TV", slug: "tv", emoji: "📺", status: "inactive", priority: 70, sort_order: 150, keywords: ["tv amazon offerte", "smart tv offerta"] },
    { name: "Casa", slug: "casa", emoji: "🛋️", status: "inactive", priority: 50, sort_order: 160, keywords: ["casa amazon offerte"] },
    { name: "Fotografia", slug: "fotografia", emoji: "📷", status: "inactive", priority: 68, sort_order: 170, keywords: ["fotografia amazon offerte", "fotocamera obiettivo offerta"] },
    { name: "Audio", slug: "audio", emoji: "🔊", status: "inactive", priority: 63, sort_order: 180, keywords: ["audio amazon offerte"] },
    { name: "Ufficio", slug: "ufficio", emoji: "🧾", status: "inactive", priority: 48, sort_order: 190, keywords: ["ufficio amazon offerte"] },
    { name: "Bellezza e cura personale", slug: "bellezza-e-cura-personale", emoji: "✨", status: "inactive", priority: 40, sort_order: 200, keywords: ["bellezza amazon offerte"] },
    { name: "Sport", slug: "sport", emoji: "🏃", status: "inactive", priority: 42, sort_order: 210, keywords: ["sport amazon offerte"] },
    { name: "Giardino", slug: "giardino", emoji: "🌿", status: "inactive", priority: 35, sort_order: 220, keywords: ["giardino amazon offerte"] },
    { name: "Altre categorie", slug: "altre-categorie", emoji: "🧩", status: "inactive", priority: 20, sort_order: 230, keywords: ["offerte amazon varie"] }
  ];

  for (const seed of categorySeeds) {
    const existing = await get("SELECT id FROM affiliate_categories WHERE slug = ?", [seed.slug]);
    if (!existing) {
      await insert("affiliate_categories", {
        name: seed.name,
        slug: seed.slug,
        description: "",
        emoji: seed.emoji,
        amazon_keywords_json: JSON.stringify(seed.keywords),
        amazon_category_reference: "",
        status: seed.status,
        priority: seed.priority,
        minimum_discount_percent: 20,
        minimum_deal_score: 65,
        max_results_per_search: 20,
        search_frequency_minutes: 60,
        telegram_enabled: meta.driver === "pg" ? true : 1,
        facebook_enabled: meta.driver === "pg" ? true : 1,
        daily_special_enabled: meta.driver === "pg" ? true : 1,
        sort_order: seed.sort_order,
        created_by_user_id: null
      });
    }
  }

  const templateSeeds = [
    {
      name: "Telegram standard",
      channel_type: "telegram",
      post_type: "standard_offer",
      text_template: "{{category_emoji}} {{product_title}}\n\n💰 Prezzo: {{current_price}}\n{{#if previous_price}}❌ Prezzo precedente: {{previous_price}}\n{{/if}}🔥 Sconto: -{{discount_percent}}%\n{{#if prime_eligible}}✅ Spedizione Prime\n{{/if}}\n👉 Link offerta: {{affiliate_url}}\n\n{{affiliate_disclosure}}\n{{price_disclaimer}}",
      button_label: "Vedi offerta su Amazon"
    },
    {
      name: "Facebook super offerta",
      channel_type: "facebook",
      post_type: "daily_special",
      text_template: "🔥 SUPER OFFERTA DEL GIORNO 🔥\n\n{{product_title}}\n\n{{#if previous_price}}💰 Prezzo precedente: {{previous_price}}\n{{/if}}✅ Prezzo offerta: {{current_price}}\n🔥 Sconto: -{{discount_percent}}%\n\n👉 Scopri l offerta: {{affiliate_url}}\n\n{{affiliate_disclosure}}\n{{price_disclaimer}}",
      button_label: ""
    },
    {
      name: "Telegram teaser giornata",
      channel_type: "telegram",
      post_type: "daily_special_teaser",
      text_template: "🔥 Abbiamo trovato la Super Offerta del Giorno\n\nScoprila sulla nostra pagina Facebook prima che termini\n\n👉 {{facebook_post_url}}",
      button_label: "Apri Facebook"
    },
    {
      name: "Facebook seconda offerta",
      channel_type: "facebook",
      post_type: "facebook_second_offer",
      text_template: "📱 {{product_title}}\n\n💰 Ora a {{current_price}}\n{{#if previous_price}}Prima: {{previous_price}}\n{{/if}}🔥 Risparmio: {{discount_percent}}%\n\n👉 {{affiliate_url}}\n\n{{affiliate_disclosure}}\n{{price_disclaimer}}",
      button_label: ""
    }
  ];

  for (const seed of templateSeeds) {
    const existing = await get(
      "SELECT id FROM affiliate_post_templates WHERE channel_type = ? AND post_type = ? AND is_default = ?",
      [seed.channel_type, seed.post_type, meta.driver === "pg" ? true : 1]
    );
    if (!existing) {
      await insert("affiliate_post_templates", {
        name: seed.name,
        channel_type: seed.channel_type,
        post_type: seed.post_type,
        category_id: null,
        text_template: seed.text_template,
        button_label: seed.button_label,
        include_product_image: meta.driver === "pg" ? true : 1,
        include_channel_logo: meta.driver === "pg" ? false : 0,
        include_price_disclaimer: meta.driver === "pg" ? true : 1,
        include_affiliate_disclosure: meta.driver === "pg" ? true : 1,
        status: "active",
        is_default: meta.driver === "pg" ? true : 1,
        created_by_user_id: null
      });
    }
  }

  const channelSeeds = [
    { type: "telegram", name: "Canale Telegram", status: "inactive" },
    { type: "facebook", name: "Pagina Facebook", status: "inactive" }
  ];
  for (const seed of channelSeeds) {
    const existing = await get("SELECT id FROM affiliate_channels WHERE type = ?", [seed.type]);
    if (!existing) {
      await insert("affiliate_channels", {
        type: seed.type,
        name: seed.name,
        external_id: "",
        public_url: "",
        status: seed.status,
        settings_json: "{}"
      });
    }
  }

  const settingSeeds = [
    ["affiliate_mode", "configuration", "text", "amazon"],
    ["affiliate_source_mode", "facebook_page", "text", "automation"],
    ["affiliate_timezone", "Europe/Rome", "text", "automation"],
    ["affiliate_search_interval_minutes", "60", "number", "automation"],
    ["affiliate_telegram_interval_minutes", "60", "number", "telegram"],
    ["affiliate_telegram_max_posts_per_day", "16", "number", "telegram"],
    ["affiliate_telegram_active_start_time", "07:00", "text", "telegram"],
    ["affiliate_telegram_active_end_time", "23:00", "text", "telegram"],
    ["affiliate_telegram_cooldown_hours", "72", "number", "telegram"],
    ["affiliate_facebook_post_1_time", "07:00", "text", "facebook"],
    ["affiliate_facebook_post_2_time", "19:00", "text", "facebook"],
    ["affiliate_facebook_cooldown_hours", "168", "number", "facebook"],
    ["affiliate_daily_special_selection_time", "06:45", "text", "facebook"],
    ["affiliate_min_discount_percent", "20", "number", "filters"],
    ["affiliate_min_deal_score", "65", "number", "filters"],
    ["affiliate_min_rating", "3.8", "number", "filters"],
    ["affiliate_min_review_count", "20", "number", "filters"],
    ["affiliate_automation_enabled", "false", "boolean", "automation"],
    ["affiliate_amazon_search_enabled", "false", "boolean", "automation"],
    ["affiliate_facebook_source_enabled", "true", "boolean", "automation"],
    ["affiliate_telegram_enabled", "false", "boolean", "telegram"],
    ["affiliate_facebook_enabled", "false", "boolean", "facebook"],
    ["affiliate_daily_special_enabled", "false", "boolean", "facebook"],
    ["affiliate_allow_facebook_text_fallback", "true", "boolean", "facebook"],
    ["affiliate_disclosure_text", "In qualita di affiliato Amazon, CreatorSpeaker TV puo ricevere una commissione dagli acquisti idonei", "text", "copy"],
    ["affiliate_price_disclaimer", "Prezzo e disponibilita possono cambiare dopo la pubblicazione", "text", "copy"]
  ];

  for (const [key, value, type, groupName] of settingSeeds) {
    const existing = await get("SELECT id FROM affiliate_settings WHERE key = ?", [key]);
    if (!existing) {
      await insert("affiliate_settings", {
        key,
        value,
        type,
        group_name: groupName,
        updated_by_user_id: null
      });
    }
  }
}

async function migrateCompat() {
  await ensureColumn("admins", "display_name", "display_name TEXT NOT NULL DEFAULT ''");
  await ensureColumn("admins", "role", "role TEXT NOT NULL DEFAULT 'admin'");
  await ensureColumn("admins", "status", "status TEXT NOT NULL DEFAULT 'active'");
  await ensureColumn("admins", "permissions_json", "permissions_json TEXT NOT NULL DEFAULT '{}'");

  await ensureColumn("content_uploads", "file_id", "file_id INTEGER");
  await ensureColumn("content_uploads", "original_filename", "original_filename TEXT");
  await ensureColumn("content_uploads", "mime_type", "mime_type TEXT");
  await ensureColumn("content_uploads", "file_size", "file_size INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("content_uploads", "progress_percent", "progress_percent INTEGER NOT NULL DEFAULT 100");

  await ensureColumn("video_jobs", "image_file_ids_json", "image_file_ids_json TEXT NOT NULL DEFAULT '[]'");
  await ensureColumn("video_jobs", "audio_file_id", "audio_file_id INTEGER");
  await ensureColumn("video_jobs", "output_file_id", "output_file_id INTEGER");
  await ensureColumn("video_jobs", "progress_percent", "progress_percent INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "status_detail", "status_detail TEXT");
  await ensureColumn("video_jobs", "render_profile_id", "render_profile_id INTEGER");
  await ensureColumn("video_jobs", "slug", "slug TEXT");
  await ensureColumn("video_jobs", "credits_charged", "credits_charged INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "credits_refunded", "credits_refunded INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "resolution", "resolution TEXT NOT NULL DEFAULT '1280x720'");
  await ensureColumn("video_jobs", "aspect_ratio", "aspect_ratio TEXT NOT NULL DEFAULT '16:9'");
  await ensureColumn("video_jobs", "total_duration_seconds", "total_duration_seconds REAL NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "audio_start_seconds", "audio_start_seconds REAL NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "audio_end_seconds", "audio_end_seconds REAL");
  await ensureColumn("video_jobs", "audio_mode", "audio_mode TEXT NOT NULL DEFAULT 'fit_video'");
  await ensureColumn("video_jobs", "audio_volume", "audio_volume REAL NOT NULL DEFAULT 1");
  await ensureColumn("video_jobs", "audio_fade_in", "audio_fade_in REAL NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "audio_fade_out", "audio_fade_out REAL NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "settings_json", "settings_json TEXT NOT NULL DEFAULT '{}'");
  await ensureColumn("video_jobs", "output_cloudinary_public_id", "output_cloudinary_public_id TEXT");
  await ensureColumn("video_jobs", "output_secure_url", "output_secure_url TEXT");
  await ensureColumn("video_jobs", "output_bytes", "output_bytes INTEGER NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "output_duration_seconds", "output_duration_seconds REAL NOT NULL DEFAULT 0");
  await ensureColumn("video_jobs", "output_format", "output_format TEXT NOT NULL DEFAULT 'mp4'");
  await ensureColumn("video_jobs", "output_filename", "output_filename TEXT");
  await ensureColumn("video_jobs", "thumbnail_cloudinary_public_id", "thumbnail_cloudinary_public_id TEXT");
  await ensureColumn("video_jobs", "thumbnail_secure_url", "thumbnail_secure_url TEXT");
  await ensureColumn("video_jobs", "started_at", "started_at TEXT");
  await ensureColumn("video_jobs", "completed_at", "completed_at TEXT");
  await ensureColumn("video_jobs", "cancelled_at", "cancelled_at TEXT");

  await ensureColumn("affiliate_products", "source_type", "source_type TEXT NOT NULL DEFAULT 'amazon'");
  await ensureColumn("affiliate_products", "source_text", "source_text TEXT NOT NULL DEFAULT ''");
  await ensureColumn("affiliate_products", "source_post_url", "source_post_url TEXT NOT NULL DEFAULT ''");

  await ensureColumn("orders", "payment_method", "payment_method TEXT NOT NULL DEFAULT 'bank_transfer'");
  await ensureColumn("orders", "payment_status", "payment_status TEXT NOT NULL DEFAULT 'pending'");
  await ensureColumn("orders", "payment_provider", "payment_provider TEXT");
  await ensureColumn("orders", "payment_reference", "payment_reference TEXT");
  await ensureColumn("orders", "payment_last_event_at", "payment_last_event_at TEXT");

  await run("CREATE INDEX IF NOT EXISTS idx_site_visit_events_created_at ON site_visit_events (created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_site_visit_events_path_created_at ON site_visit_events (path, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_site_visit_events_visitor_hash ON site_visit_events (visitor_hash)");
  await run("CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens (token_hash)");
  await run("CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens (user_id)");
  await run("CREATE INDEX IF NOT EXISTS idx_video_jobs_user_created ON video_jobs (user_id, created_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_video_jobs_status_updated ON video_jobs (status, updated_at)");
  await run("CREATE INDEX IF NOT EXISTS idx_video_job_images_job_order ON video_job_images (video_job_id, sort_order)");
  await seedDefaultVideoProfiles();
  await createOutreachTables();
  await createAffiliateDealsTables();
}

async function query(sql, params = []) {
  if (meta.driver === "pg") {
    const result = await meta.pool.query(adaptPlaceholders(sql, params), params);
    return result.rows;
  }

  const trimmed = sql.trim().toLowerCase();
  if (trimmed.startsWith("select") || trimmed.startsWith("pragma")) {
    return meta.sqlite.prepare(sql).all(params);
  }

  meta.sqlite.prepare(sql).run(params);
  return [];
}

async function get(sql, params = []) {
  if (meta.driver === "pg") {
    const result = await meta.pool.query(adaptPlaceholders(sql, params), params);
    return result.rows[0] || null;
  }

  return meta.sqlite.prepare(sql).get(params) || null;
}

async function all(sql, params = []) {
  return query(sql, params);
}

async function run(sql, params = []) {
  if (meta.driver === "pg") {
    const result = await meta.pool.query(adaptPlaceholders(sql, params), params);
    return {
      changes: result.rowCount,
      lastInsertRowid: result.rows[0] ? result.rows[0].id : null
    };
  }

  const result = meta.sqlite.prepare(sql).run(params);
  return {
    changes: result.changes,
    lastInsertRowid: result.lastInsertRowid
  };
}

async function insert(table, payload) {
  const keys = Object.keys(payload);
  const placeholders = keys.map(() => "?").join(", ");
  const values = keys.map((key) => payload[key]);
  const sql = `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${placeholders})`;
  if (meta.driver === "pg") {
    const pgSql = `${sql} RETURNING id`;
    const result = await meta.pool.query(adaptPlaceholders(pgSql, values), values);
    return result.rows[0].id;
  }

  const result = meta.sqlite.prepare(sql).run(values);
  return result.lastInsertRowid;
}

async function getSetting(key, fallback = null) {
  const row = await get("SELECT key, value_json FROM settings WHERE key = ?", [key]);
  if (!row) {
    return fallback;
  }

  try {
    return JSON.parse(row.value_json);
  } catch (error) {
    return fallback;
  }
}

async function setSetting(key, value) {
  const valueJson = JSON.stringify(value);
  const existing = await get("SELECT key FROM settings WHERE key = ?", [key]);
  if (existing) {
    await run(
      "UPDATE settings SET value_json = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
      [valueJson, key]
    );
  } else {
    await run("INSERT INTO settings (key, value_json) VALUES (?, ?)", [key, valueJson]);
  }
}

async function getSettingsMap() {
  const rows = await all("SELECT key, value_json, updated_at FROM settings");
  return rows.reduce((acc, row) => {
    try {
      acc[row.key] = JSON.parse(row.value_json);
    } catch (error) {
      acc[row.key] = row.value_json;
    }
    return acc;
  }, {});
}

if (require.main === module) {
  initialize()
    .then(() => {
      console.log(`Database ready using ${meta.driver}`);
      process.exit(0);
    })
    .catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
}

module.exports = {
  meta,
  initialize,
  migrate,
  query,
  get,
  all,
  run,
  insert,
  getSetting,
  setSetting,
  getSettingsMap
};
