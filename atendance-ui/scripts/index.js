const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const port = 3000;

app.use(cors()); // ブラウザからのアクセスを許可
app.use(express.json()); // POSTやPUTで送られてくるJSONデータを解析

/**
 * GET /api/users/student/:student_number
 * 用途: 学籍番号でアクティブなユーザーを1名検索する (認証、カード検知用)
 */
app.get('/api/users/student/:student_number', async (req, res) => {
  const { student_number } = req.params;
  try {
    const sql = "SELECT * FROM users WHERE student_number = $1 AND deleted = false AND is_active = true";
    const { rows, rowCount } = await db.query(sql, [student_number]);

    if (rowCount === 0) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * POST /api/users
 * 用途: 新しいユーザーを登録
 */
app.post('/api/users', async (req, res) => {
  const { student_number, name_kanji, name_kana, birthday, publication_date, expiry_date } = req.body;
  
  if (!student_number) {
    return res.status(400).json({ error: 'student_number は必須です' });
  }

  const created_at = new Date();
  const sql = `
    INSERT INTO users 
    (student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at, is_active, deleted) 
    VALUES ($1, $2, $3, $4, $5, $6, $7, true, false)
    RETURNING *`;
    
  try {
    const { rows } = await db.query(sql, [
      student_number, name_kanji, name_kana, birthday, 
      publication_date, expiry_date, created_at
    ]);
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    // PostgreSQLのユニーク制約違反エラーコード
    if (err.code === '23505') { 
      return res.status(409).json({ error: 'その学籍番号は既に使用されています' });
    }
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * GET /api/users/active
 * 用途: 現在在室中の全ユーザー一覧を取得する (メインタブ用)
 */
app.get('/api/users/active', async (req, res) => {
  const currentDate = new Date().toISOString().split('T')[0];
  const startOfDay = `${currentDate} 00:07:00`;
  const endOfDay = `${new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 06:59:59`;

  try {
    // 1. 今日の最新ログがあるユーザー (在室/休憩中)
    const todayActiveSql = `
      SELECT DISTINCT ON (u.id) 
          u.id, u.student_number, u.name_kanji, u.name_kana,
          al.mode, al.timestamp
      FROM users u
      JOIN attendance_logs al ON u.id = al.user_id
      WHERE al.timestamp BETWEEN $1 AND $2
        AND u.is_active = true AND u.deleted = false
      ORDER BY u.id, al.timestamp DESC;
    `;
    const { rows: todayActiveUsers } = await db.query(todayActiveSql, [startOfDay, endOfDay]);

    // 2. 今日ログがないアクティブユーザー (退室扱い)
    const noTodayActiveSql = `
      SELECT id, student_number, name_kanji, name_kana
      FROM users
      WHERE is_active = true AND deleted = false
      AND id NOT IN (
          SELECT DISTINCT user_id FROM attendance_logs
          WHERE timestamp BETWEEN $1 AND $2
      );
    `;
    const { rows: noTodayActiveUsers } = await db.query(noTodayActiveSql, [startOfDay, endOfDay]);

    // ログがないユーザーに 'out' ステータスを付与
    const noTodayActiveUsersWithStatus = noTodayActiveUsers.map(user => ({
      ...user,
      mode: 'out',
      timestamp: null
    }));

    // 3. 2つのリストを結合して返す
    res.json([...todayActiveUsers, ...noTodayActiveUsersWithStatus]);

  } catch (err) {
    console.error('Error fetching active users:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});


/**
 * -------------------------------------------
 * 入退室 (Attendance) 関連 API
 * -------------------------------------------
 */

/**
 * POST /api/attendance
 * 用途: 新しい入退室ログを作成する
 */
app.post('/api/attendance', async (req, res) => {
  const { student_id, mode, subscribed_by, selected_by } = req.body;
  
  if (!student_id || !mode) {
    return res.status(400).json({ error: 'student_id と mode は必須です' });
  }

  const timestamp = new Date();
  
  try {
    // 1. 学籍番号 (student_id) から ユーザーID (user_id) を検索
    const userSql = "SELECT id FROM users WHERE student_number = $1";
    const userRes = await db.query(userSql, [student_id]);

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'ログを記録するユーザーが見つかりません' });
    }
    const userId = userRes.rows[0].id; // 該当する user_id

    // 2. 見つけた user_id を使ってログを記録
    const logSql = `
      INSERT INTO attendance_logs (user_id, timestamp, mode, subscribed_by, selected_by, deleted) 
      VALUES ($1, $2, $3, $4, $5, false) 
      RETURNING *`;
    
    const { rows } = await db.query(logSql, [
      userId, 
      timestamp, 
      mode, 
      subscribed_by, 
      selected_by
    ]);
    
    res.status(201).json(rows[0]); // 作成されたログを返す
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * GET /api/attendance/latest/:user_id
 * 用途: 特定ユーザーの最新のログを (日付範囲内で) 取得する
 */
app.get('/api/attendance/latest/:user_id', async (req, res) => {
  const { user_id } = req.params;
  const { start, end } = req.query; // クエリパラメータから日付範囲を取得

  try {
    let sql, params;
    
    // 日付範囲の指定がある場合
    if (start && end) {
      sql = `
        SELECT * FROM attendance_logs 
        WHERE user_id = $1 AND timestamp BETWEEN $2 AND $3
        ORDER BY timestamp DESC 
        LIMIT 1`;
      params = [user_id, start, end];
    } else {
      // 日付範囲指定がない場合 (単純な最新ログ)
      sql = "SELECT * FROM attendance_logs WHERE user_id = $1 ORDER BY timestamp DESC LIMIT 1";
      params = [user_id];
    }

    const { rows, rowCount } = await db.query(sql, params);
    if (rowCount === 0) {
      return res.status(404).json({ error: 'ログが見つかりません' });
    }
    res.json(rows[0]);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

/**
 * GET /api/attendance/student/:student_number
 * 用途: 特定の学籍番号の全ログ履歴を取得する (ログタブ用)
 */
app.get('/api/attendance/student/:student_number', async (req, res) => {
    const { student_number } = req.params;
    try {
        const sql = `
            SELECT al.id, al.timestamp, al.mode, u.student_number, u.name_kanji, u.name_kana
            FROM attendance_logs al
            JOIN users u ON al.user_id = u.id
            WHERE u.student_number = $1
            ORDER BY al.timestamp DESC`;
        const { rows } = await db.query(sql, [student_number]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});


// --- サーバーを起動 ---
app.listen(port, () => {
  console.log(`✅ APIサーバー (Express + PostgreSQL) が http://localhost:${port} で起動しました`);
});