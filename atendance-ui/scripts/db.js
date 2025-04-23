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

function getUserIdByStudentNumber(studentNumber) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id FROM users WHERE student_number = ?`,
      [studentNumber],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getLatestAttendanceLogById(userid, startOfDay, endOfDay) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT mode, timestamp FROM attendance_logs
       WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
       ORDER BY timestamp DESC LIMIT 1`,
      [userid, startOfDay, endOfDay],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getLatestAttendanceLog(startOfDay, endOfDay) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT a.user_id, u.student_number, u.name_kanji, u.name_kana, a.mode, a.timestamp
       FROM attendance_logs a
       JOIN users u ON a.user_id = u.id
       WHERE a.timestamp >= ? AND a.timestamp <= ?
       ORDER BY a.timestamp DESC LIMIT 1`,
      [startOfDay, endOfDay],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      }
    );
  });
}

function getHasNoAttendanceLogToday(startOfDay, endOfDay) {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT u.id, u.student_number, u.name_kanji, u.name_kana
       FROM users u
       WHERE u.is_active = 1
         AND NOT EXISTS (
           SELECT 1
           FROM attendance_logs a
           WHERE a.user_id = u.id
             AND a.timestamp >= ?
             AND a.timestamp <= ?
         )
       ORDER BY u.student_number ASC`,
      [startOfDay, endOfDay],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

function saveAttendanceLog(userId, mode) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT INTO attendance_logs (user_id, mode, timestamp)
       VALUES (?, ?, ?)`,
      [userId, mode, new Date().toISOString()],
      (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

// ユーザーを保存する関数
function saveUser(user) {
  return new Promise((resolve, reject) => {
    const {
      student_number,
      name_kanji,
      name_kana,
      birthday,
      publication_date,
      expiry_date,
      created_at,
    } = user;

    db.run(
      `INSERT INTO users (student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at],
      function (err) {
        if (err) {
          reject(new Error(`Database error: ${err.message}`));
        } else {
          resolve(true);
        }
      }
    );
  });
}

function fetchActiveUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT u.student_number, u.name_kanji, u.name_kana, a.mode, a.timestamp
       FROM users u
       LEFT JOIN attendance_logs a
         ON u.id = a.user_id
       WHERE u.is_active = 1
         AND a.timestamp = (
           SELECT MAX(a2.timestamp)
           FROM attendance_logs a2
           WHERE a2.user_id = u.id
         )
       ORDER BY a.timestamp DESC`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

function fetchActiveAllUsers() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT u.student_number, u.name_kanji, u.name_kana
       FROM users u
       WHERE u.is_active = 1
         AND NOT EXISTS (
           SELECT 1
           FROM attendance_logs a
           WHERE a.user_id = u.id
         )
       ORDER BY u.student_number ASC`,
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

module.exports = {
  getUserIdByStudentNumber,
  getLatestAttendanceLogById,
  getLatestAttendanceLog,
  getHasNoAttendanceLogToday,
  saveAttendanceLog,
  saveUser,
  fetchActiveUsers,
  fetchActiveAllUsers,
};