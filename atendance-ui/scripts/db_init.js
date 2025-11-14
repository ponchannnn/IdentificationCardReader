const db = require('./db');

async function createUsersTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      student_number TEXT UNIQUE NOT NULL,
      name_kanji TEXT,
      name_kana TEXT,
      birthday TEXT,
      publication_date TEXT,
      expiry_date TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      is_active BOOLEAN DEFAULT true,
      deleted BOOLEAN DEFAULT false
    )
  `;
  try {
    await db.query(createTableQuery);
    console.log('テーブル "users" の準備が完了しました。');
  } catch (err) {
    console.error('usersテーブル作成中にエラーが発生しました:', err);
  }
}

async function createAttendanceLogsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, -- ユーザー削除時にログは残す
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      mode TEXT, -- 'in', 'out', 'rest'
      subscribed_by TEXT, -- 'card', 'manual'
      selected_by TEXT, -- 'system', 'manual'
      deleted BOOLEAN DEFAULT false
    )
  `;
  try {
    await db.query(createTableQuery);
    console.log('テーブル "attendance_logs" の準備が完了しました。');
  } catch (err) {
    console.error('attendance_logsテーブル作成中にエラーが発生しました:', err);
  }
}

async function createOperationLogsTable() {
  const createTableQuery = `
    CREATE TABLE IF NOT EXISTS operation_logs (
      id SERIAL PRIMARY KEY,
      operator_user_id INTEGER REFERENCES users(id),
      target_user_id INTEGER REFERENCES users(id),
      operation_type TEXT,
      details TEXT,
      timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
  try {
    await db.query(createTableQuery);
    console.log('テーブル "operation_logs" の準備が完了しました。');
  } catch (err) {
    console.error('operation_logsテーブル作成中にエラーが発生しました:', err);
  }
}

async function createTables() {
  await createUsersTable();
  await createAttendanceLogsTable();
  await createOperationLogsTable();
  console.log("すべてのテーブル準備が完了しました。");
  
  try {
    const { pool } = require('./db');
    if (pool) {
      await pool.end();
      console.log('DBプールを解放しました。');
    }
  } catch(e) {
  }
}

createTables();