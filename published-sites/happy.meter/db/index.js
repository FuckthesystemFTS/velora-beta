const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");

let instance;

const DAILY_ENTRY_COLUMNS = [
  { name: "mood", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "nutrition", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "outdoor_time", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "rest_breaks", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "self_care", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "meaning", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "engagement", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "day_satisfaction", sqlite: "INTEGER NOT NULL DEFAULT 5", pg: "INTEGER NOT NULL DEFAULT 5" },
  { name: "score_band", sqlite: "TEXT NOT NULL DEFAULT 'good'", pg: "TEXT NOT NULL DEFAULT 'good'" },
  { name: "components_json", sqlite: "TEXT NOT NULL DEFAULT '{}'", pg: "TEXT NOT NULL DEFAULT '{}'" },
  { name: "gratitude_text", sqlite: "TEXT", pg: "TEXT" },
  { name: "result_label", sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''" },
  { name: "result_explanation", sqlite: "TEXT NOT NULL DEFAULT ''", pg: "TEXT NOT NULL DEFAULT ''" },
  { name: "is_public_preview", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" }
];

const USER_COLUMNS = [
  { name: "ban_status", sqlite: "TEXT NOT NULL DEFAULT 'active'", pg: "TEXT NOT NULL DEFAULT 'active'" },
  { name: "ban_reason", sqlite: "TEXT", pg: "TEXT" },
  { name: "banned_until", sqlite: "TEXT", pg: "TIMESTAMP" },
  { name: "banned_at", sqlite: "TEXT", pg: "TIMESTAMP" },
  { name: "banned_by_admin_id", sqlite: "INTEGER", pg: "INTEGER" }
];

const COMMUNITY_POST_COLUMNS = [
  { name: "is_hidden", sqlite: "INTEGER NOT NULL DEFAULT 0", pg: "INTEGER NOT NULL DEFAULT 0" },
  { name: "hidden_reason", sqlite: "TEXT", pg: "TEXT" },
  { name: "hidden_at", sqlite: "TEXT", pg: "TIMESTAMP" },
  { name: "hidden_by_admin_id", sqlite: "INTEGER", pg: "INTEGER" }
];

const TEST_RESULT_COLUMNS = [
  { name: "reflection_text", sqlite: "TEXT", pg: "TEXT" }
];

function createPgSql(sql, params) {
  let index = 0;
  return {
    text: sql.replace(/\?/g, () => {
      index += 1;
      return `$${index}`;
    }),
    values: params
  };
}

function buildInsertSql(table, data, engine) {
  const columns = Object.keys(data);
  const placeholders = columns.map(() => "?").join(", ");
  const base = `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;
  return engine === "pg" ? `${base} RETURNING *` : base;
}

function buildUpdateSql(table, data, whereClause) {
  const setters = Object.keys(data)
    .map((column) => `${column} = ?`)
    .join(", ");
  return `UPDATE ${table} SET ${setters} WHERE ${whereClause}`;
}

function buildDailyEntrySql(engine) {
  const idColumn = engine === "pg" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const dateType = engine === "pg" ? "DATE" : "TEXT";
  const timestampType = engine === "pg" ? "TIMESTAMP" : "TEXT";
  const foreignUser = engine === "pg" ? "REFERENCES users(id)" : "";

  return `CREATE TABLE IF NOT EXISTS daily_entries (
    id ${idColumn},
    user_id INTEGER NOT NULL ${foreignUser},
    entry_date ${dateType} NOT NULL,
    happiness INTEGER NOT NULL DEFAULT 5,
    energy INTEGER NOT NULL DEFAULT 5,
    sleep INTEGER NOT NULL DEFAULT 5,
    stress INTEGER NOT NULL DEFAULT 5,
    mood INTEGER NOT NULL DEFAULT 5,
    physical_activity INTEGER NOT NULL DEFAULT 5,
    nutrition INTEGER NOT NULL DEFAULT 5,
    outdoor_time INTEGER NOT NULL DEFAULT 5,
    rest_breaks INTEGER NOT NULL DEFAULT 5,
    self_care INTEGER NOT NULL DEFAULT 5,
    social_relations INTEGER NOT NULL DEFAULT 5,
    gratitude INTEGER NOT NULL DEFAULT 5,
    meaning INTEGER NOT NULL DEFAULT 5,
    engagement INTEGER NOT NULL DEFAULT 5,
    day_satisfaction INTEGER NOT NULL DEFAULT 5,
    happy_score INTEGER NOT NULL DEFAULT 50,
    score_band TEXT NOT NULL DEFAULT 'good',
    result_label TEXT NOT NULL DEFAULT '',
    result_explanation TEXT NOT NULL DEFAULT '',
    components_json TEXT NOT NULL DEFAULT '{}',
    note TEXT,
    people_text TEXT,
    good_things_text TEXT,
    hard_things_text TEXT,
    gratitude_text TEXT,
    activities_text TEXT,
    is_public_preview INTEGER NOT NULL DEFAULT 0,
    created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, entry_date)
  )`;
}

async function createTables(db) {
  const engine = db.engine;
  const idColumn = engine === "pg" ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  const timestampType = engine === "pg" ? "TIMESTAMP" : "TEXT";
  const dateType = engine === "pg" ? "DATE" : "TEXT";
  const fkUser = engine === "pg" ? "REFERENCES users(id)" : "";
  const fkActivity = engine === "pg" ? "REFERENCES activities(id)" : "";
  const fkGesture = engine === "pg" ? "REFERENCES happy_gestures(id)" : "";
  const fkBadge = engine === "pg" ? "REFERENCES badges(id)" : "";
  const fkPost = engine === "pg" ? "REFERENCES community_posts(id)" : "";
  const fkMission = engine === "pg" ? "REFERENCES happiness_missions(id)" : "";

  const statements = [
    engine === "sqlite" ? "PRAGMA foreign_keys = ON" : null,
    `CREATE TABLE IF NOT EXISTS users (
      id ${idColumn},
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      preferred_language TEXT NOT NULL DEFAULT 'it',
      points INTEGER NOT NULL DEFAULT 0,
      level INTEGER NOT NULL DEFAULT 1,
      current_streak INTEGER NOT NULL DEFAULT 0,
      happy_gesture_streak INTEGER NOT NULL DEFAULT 0,
      premium_status TEXT NOT NULL DEFAULT 'coming-soon',
      ban_status TEXT NOT NULL DEFAULT 'active',
      ban_reason TEXT,
      banned_until ${timestampType},
      banned_at ${timestampType},
      banned_by_admin_id INTEGER,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    buildDailyEntrySql(engine),
    `CREATE TABLE IF NOT EXISTS activities (
      id ${idColumn},
      name_it TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_de TEXT NOT NULL,
      name_es TEXT NOT NULL,
      description_it TEXT NOT NULL,
      description_en TEXT NOT NULL,
      description_de TEXT NOT NULL,
      description_es TEXT NOT NULL,
      category TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 5,
      icon TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_activities (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      activity_id INTEGER ${fkActivity},
      custom_name TEXT,
      completed_date ${dateType} NOT NULL,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS happy_gestures (
      id ${idColumn},
      text_it TEXT NOT NULL,
      text_en TEXT NOT NULL,
      text_de TEXT NOT NULL,
      text_es TEXT NOT NULL,
      points INTEGER NOT NULL DEFAULT 15,
      active INTEGER NOT NULL DEFAULT 1,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS user_happy_gestures (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      happy_gesture_id INTEGER NOT NULL ${fkGesture},
      gesture_date ${dateType} NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      points_awarded INTEGER NOT NULL DEFAULT 0,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, gesture_date)
    )`,
    `CREATE TABLE IF NOT EXISTS badges (
      id ${idColumn},
      code TEXT NOT NULL UNIQUE,
      name_it TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_de TEXT NOT NULL,
      name_es TEXT NOT NULL,
      description_it TEXT NOT NULL,
      description_en TEXT NOT NULL,
      description_de TEXT NOT NULL,
      description_es TEXT NOT NULL,
      icon TEXT NOT NULL,
      rule_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS user_badges (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      badge_id INTEGER NOT NULL ${fkBadge},
      unlocked_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, badge_id)
    )`,
    `CREATE TABLE IF NOT EXISTS community_posts (
      id ${idColumn},
      user_id INTEGER,
      author_name TEXT NOT NULL,
      content TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT 'it',
      is_demo INTEGER NOT NULL DEFAULT 1,
      is_hidden INTEGER NOT NULL DEFAULT 0,
      hidden_reason TEXT,
      hidden_at ${timestampType},
      hidden_by_admin_id INTEGER,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS community_post_likes (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      post_id INTEGER NOT NULL ${fkPost},
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, post_id)
    )`,
    `CREATE TABLE IF NOT EXISTS happy_tests (
      id ${idColumn},
      code TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS happiness_missions (
      id ${idColumn},
      text TEXT NOT NULL UNIQUE,
      weight INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS daily_test_missions (
      id ${idColumn},
      user_id INTEGER ${fkUser},
      anonymous_session_id TEXT,
      test_code TEXT NOT NULL,
      date ${dateType} NOT NULL,
      mission_id INTEGER NOT NULL ${fkMission},
      normalized_points INTEGER NOT NULL DEFAULT 0,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS test_results (
      id ${idColumn},
      user_id INTEGER ${fkUser},
      anonymous_session_id TEXT,
      test_code TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      slider_score INTEGER,
      missions_score INTEGER,
      reflection_score INTEGER,
      reflection_text TEXT,
      answers_json TEXT NOT NULL DEFAULT '{}',
      completed_missions_json TEXT NOT NULL DEFAULT '[]',
      date ${dateType} NOT NULL,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS test_likes (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      test_code TEXT NOT NULL,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, test_code)
    )`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id ${idColumn},
      user_id INTEGER NOT NULL ${fkUser},
      token_hash TEXT NOT NULL UNIQUE,
      expires_at ${timestampType} NOT NULL,
      used_at ${timestampType},
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS admin_users (
      id ${idColumn},
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at ${timestampType} NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ].filter(Boolean);

  for (const statement of statements) {
    await db.exec(statement);
  }
}

async function getExistingColumns(db, tableName) {
  if (db.engine === "pg") {
    const rows = await db.all(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ?`,
      [tableName]
    );
    return new Set(rows.map((row) => row.column_name));
  }

  const rows = await db.all(`PRAGMA table_info(${tableName})`);
  return new Set(rows.map((row) => row.name));
}

async function ensureColumns(db) {
  const targets = [
    { tableName: "daily_entries", columns: DAILY_ENTRY_COLUMNS },
    { tableName: "users", columns: USER_COLUMNS },
    { tableName: "community_posts", columns: COMMUNITY_POST_COLUMNS },
    { tableName: "test_results", columns: TEST_RESULT_COLUMNS }
  ];

  for (const target of targets) {
    const existing = await getExistingColumns(db, target.tableName);
    for (const column of target.columns) {
      if (existing.has(column.name)) {
        continue;
      }
      const definition = db.engine === "pg" ? column.pg : column.sqlite;
      await db.exec(`ALTER TABLE ${target.tableName} ADD COLUMN ${column.name} ${definition}`);
    }
  }
}

async function initDatabase() {
  if (instance) {
    return instance;
  }

  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
    });

    instance = {
      engine: "pg",
      async exec(sql) {
        await pool.query(sql);
      },
      async get(sql, params = []) {
        const compiled = createPgSql(sql, params);
        const result = await pool.query(compiled.text, compiled.values);
        return result.rows[0] || null;
      },
      async all(sql, params = []) {
        const compiled = createPgSql(sql, params);
        const result = await pool.query(compiled.text, compiled.values);
        return result.rows;
      },
      async run(sql, params = []) {
        const compiled = createPgSql(sql, params);
        const result = await pool.query(compiled.text, compiled.values);
        return { changes: result.rowCount, rows: result.rows };
      },
      async insert(table, data) {
        const compiled = createPgSql(buildInsertSql(table, data, "pg"), Object.values(data));
        const result = await pool.query(compiled.text, compiled.values);
        return result.rows[0];
      },
      async update(table, data, whereClause, whereParams = []) {
        return this.run(buildUpdateSql(table, data, whereClause), [...Object.values(data), ...whereParams]);
      }
    };
  } else {
    const sqlitePath = path.resolve(process.cwd(), process.env.SQLITE_PATH || "./db/happymeter.sqlite");
    fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    const db = await open({
      filename: sqlitePath,
      driver: sqlite3.Database
    });

    instance = {
      engine: "sqlite",
      async exec(sql) {
        await db.exec(sql);
      },
      async get(sql, params = []) {
        return db.get(sql, params);
      },
      async all(sql, params = []) {
        return db.all(sql, params);
      },
      async run(sql, params = []) {
        return db.run(sql, params);
      },
      async insert(table, data) {
        const result = await db.run(buildInsertSql(table, data, "sqlite"), Object.values(data));
        return { id: result.lastID, ...data };
      },
      async update(table, data, whereClause, whereParams = []) {
        return db.run(buildUpdateSql(table, data, whereClause), [...Object.values(data), ...whereParams]);
      }
    };
  }

  await createTables(instance);
  await ensureColumns(instance);
  return instance;
}

function getDb() {
  if (!instance) {
    throw new Error("Database not initialized");
  }
  return instance;
}

module.exports = {
  getDb,
  initDatabase
};
