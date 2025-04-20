const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'card_logs.db');
const db = new sqlite3.Database(dbPath);

// テーブル作成
db.serialize(() => {
  // usersテーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_number TEXT,
      name_kanji TEXT,
      name_kana TEXT,
      birthday TEXT,
      publication_date TEXT,
      expiry_date TEXT,
      created_at TEXT,
      is_active BOOLEAN DEFAULT 1,
      deleted BOOLEAN DEFAULT 0
    )
  `);

  // attendance_logsテーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS attendance_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      timestamp TEXT,
      mode TEXT,
      deleted BOOLEAN DEFAULT 0,
      updated_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )
  `);

  // operation_logsテーブル
  db.run(`
    CREATE TABLE IF NOT EXISTS operation_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      operator_user_id INTEGER,
      target_user_id INTEGER,
      operation_type TEXT,
      details TEXT,
      timestamp TEXT,
      FOREIGN KEY (operator_user_id) REFERENCES users (id),
      FOREIGN KEY (target_user_id) REFERENCES users (id)
    )
  `);
});

// ユーザーを保存する関数
function saveUser(user, callback) {
  const {
    student_number,
    name_kanji,
    name_kana,
    birthday,
    publication_date,
    expiry_date,
    created_at,
  } = user;

  // 既存ユーザーの確認
  db.get(
    `SELECT id FROM users WHERE student_number = ?`,
    [student_number],
    (err, row) => {
      if (err) {
        console.error('Error checking user existence:', err);
        if (callback) callback({ success: false, error: 'DATABASE_ERROR' });
        return;
      }

      if (row) {
        console.log('User already exists in the database');
        if (callback) callback({ success: false, error: 'USER_ALREADY_EXISTS' });
      } else {
        db.run(
          `INSERT INTO users (student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at],
          (err) => {
            if (err) {
              console.error('Error saving user to database:', err);
              if (callback) callback({ success: false, error: 'DATABASE_ERROR' });
            } else {
              console.log('User saved to database');
              if (callback) callback({ success: true });
            }
          }
        );
      }
    }
  );
}

// 出席ログを保存する関数
function saveAttendanceLog(log) {
  return new Promise((resolve, reject) => {
    const { student_number, timestamp, mode, updated_at } = log;
    let user_id = null;

    // user_idの存在確認
    db.get(
      `SELECT id FROM users WHERE student_number = ?`,
      [student_number],
      (err, row) => {
        if (err) {
          console.error('Error checking user existence for attendance log:', err);
          return reject('DATABASE_ERROR');
        }

        if (!row) {
          console.log('User ID does not exist in the database');
          return reject('USER_NOT_FOUND');
        }

        user_id = row.id;
        db.run(
          `INSERT INTO attendance_logs (user_id, timestamp, mode, updated_at)
           VALUES (?, ?, ?, ?)`,
          [user_id, timestamp, mode, updated_at],
          (err) => {
            if (err) {
              console.error('Error saving attendance log to database:', err);
              return reject('DATABASE_ERROR');
            } else {
              console.log('Attendance log saved to database');
              resolve();
            }
          }
        );
      }
    );
  });
}

// 操作ログを保存する関数
function saveOperationLog(log, callback) {
  const { operator_user_id, target_user_id, operation_type, details, timestamp } = log;

  // operator_user_idの存在確認
  db.get(
    `SELECT id FROM users WHERE id = ?`,
    [operator_user_id],
    (err, operatorRow) => {
      if (err) {
        console.error('Error checking operator user existence:', err);
        if (callback) callback({ success: false, error: 'DATABASE_ERROR' });
        return;
      }

      if (!operatorRow) {
        console.log('Operator user ID does not exist in the database');
        if (callback) callback({ success: false, error: 'OPERATOR_USER_NOT_FOUND' });
        return;
      }

      // target_user_idの存在確認
      db.get(
        `SELECT id FROM users WHERE id = ?`,
        [target_user_id],
        (err, targetRow) => {
          if (err) {
            console.error('Error checking target user existence:', err);
            if (callback) callback({ success: false, error: 'DATABASE_ERROR' });
            return;
          }

          if (!targetRow) {
            console.log('Target user ID does not exist in the database');
            if (callback) callback({ success: false, error: 'TARGET_USER_NOT_FOUND' });
          } else {
            db.run(
              `INSERT INTO operation_logs (operator_user_id, target_user_id, operation_type, details, timestamp)
               VALUES (?, ?, ?, ?, ?)`,
              [operator_user_id, target_user_id, operation_type, details, timestamp],
              (err) => {
                if (err) {
                  console.error('Error saving operation log to database:', err);
                  if (callback) callback({ success: false, error: 'DATABASE_ERROR' });
                } else {
                  console.log('Operation log saved to database');
                  if (callback) callback({ success: true });
                }
              }
            );
          }
        }
      );
    }
  );
}

module.exports = { saveUser, saveAttendanceLog, saveOperationLog };