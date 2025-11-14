const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const port = 3000;

const SECRET_KEY = '';

app.use(cors()); // ブラウザからのアクセスを許可
app.use(express.json()); // POSTやPUTで送られてくるJSONデータを解析

const checkAuth = (req, res, next) => {
  const apiKey = req.get('X-API-Key');
  if (apiKey && apiKey === SECRET_KEY) {
    return next();
  }

  res.status(401).json({ error: 'Unauthorized' });
};

/**
 * GET /api/users/student/:student_number
 * 用途: 学籍番号でアクティブなユーザーを1名検索する (認証、カード検知用)
 */
app.get('/api/users/student/:student_number', checkAuth, async (req, res) => {
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
app.post('/api/users', checkAuth, async (req, res) => {
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
app.get('/api/users/active', checkAuth, async (req, res) => {
  const currentDate = new Date().toISOString().split('T')[0];
  const startOfDay = `${currentDate} 00:07:00`;
  const endOfDay = `${new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 06:59:59`;

  try {
    const todayActiveSql = `
      SELECT DISTINCT ON (u.id) 
          u.id, u.student_number, u.name_kanji, u.name_kana,
          al.mode, al.timestamp
      FROM users u
      JOIN attendance_logs al ON u.id = al.user_id
      WHERE al.timestamp BETWEEN $1 AND $2
        AND u.is_active = true AND u.deleted = false AND al.deleted = false
      ORDER BY u.id, al.timestamp DESC;
    `;
    const { rows: todayActiveUsers } = await db.query(todayActiveSql, [startOfDay, endOfDay]);

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

    const noTodayActiveUsersWithStatus = noTodayActiveUsers.map(user => ({
      ...user,
      mode: 'out',
      timestamp: null
    }));

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
app.post('/api/attendance', checkAuth, async (req, res) => {
  const { student_id, mode, subscribed_by, selected_by } = req.body;
  
  if (!student_id || !mode) {
    return res.status(400).json({ error: 'student_id と mode は必須です' });
  }

  const timestamp = new Date();
  
  try {
    const userSql = "SELECT id FROM users WHERE student_number = $1 AND deleted = false";
    const userRes = await db.query(userSql, [student_id]);

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: 'ログを記録するユーザーが見つかりません' });
    }
    const userId = userRes.rows[0].id;

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
app.get('/api/attendance/latest/:user_id', checkAuth, async (req, res) => {
  const { user_id } = req.params;
  const { start, end } = req.query;

  try {
    let sql, params;
    
    if (start && end) {
      sql = `
        SELECT * FROM attendance_logs 
        WHERE user_id = $1 AND timestamp BETWEEN $2 AND $3 AND deleted = false
        ORDER BY timestamp DESC 
        LIMIT 1`;
      params = [user_id, start, end];
    } else {
      sql = "SELECT * FROM attendance_logs WHERE user_id = $1 AND deleted = false ORDER BY timestamp DESC LIMIT 1";
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
 * GET /api/attendance/recent
 * 用途: 全ユーザーの最新の入退室ログを20件取得する (ログタブ初期表示用)
 */
app.get('/api/attendance/recent', checkAuth, async (req, res) => {
    try {
        const sql = `
            SELECT 
                al.id, al.timestamp, al.mode, al.subscribed_by, al.selected_by,
                u.id AS user_id,
                u.student_number, u.name_kanji, u.name_kana
            FROM attendance_logs al
            JOIN users u ON al.user_id = u.id
            WHERE al.deleted = false
            ORDER BY al.timestamp DESC
            LIMIT 20 OFFSET $1;
        `;
        const { rows } = await db.query(sql, [req.query.page ? req.query.page * 20 : 0]);
        res.json(rows);
    } catch (err) {
        console.error('Recent logs fetch error:', err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

/**
 * GET /api/attendance/student/:student_number
 * 用途: 特定の学籍番号の全ログ履歴を取得する (ログタブ用)
 */
app.get('/api/attendance/student/:student_number', checkAuth, async (req, res) => {
    const { student_number } = req.params;
    try {
        const sql = `
            SELECT al.id, al.timestamp, al.mode, u.student_number, u.name_kanji, u.name_kana
            FROM attendance_logs al
            JOIN users u ON al.user_id = u.id
            WHERE u.student_number = $1 AND u.deleted = false AND al.deleted = false
            ORDER BY al.timestamp DESC
            LIMIT 20 OFFSET $2;
        `;
        const { rows } = await db.query(sql, [student_number, req.query.page ? req.query.page * 20 : 0]);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'サーバーエラーが発生しました' });
    }
});

/**
 * PUT /api/attendance/edit
 * 用途: 特定の学籍番号のデータを更新/作成する (ログタブ用)
 */
app.put('/api/attendance/edit', checkAuth, async (req, res) => {
  const { logId, newMode, newTimestamp } = req.body;

  if (!logId || !newMode || !newTimestamp) {
    return res.status(400).json({
        error: 'logId, newMode と newTimestamp は必須です'
    });
  }

  const client = await db.getClient();

  try {
      await client.query('BEGIN');

      const selectSql = "SELECT user_id, subscribed_by FROM attendance_logs WHERE id = $1 AND deleted = false FOR UPDATE";
      const selectRes = await client.query(selectSql, [logId]);

      if (selectRes.rowCount === 0) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: '編集対象のログが見つからないか、既に変更されています' });
      }

      const originalLog = selectRes.rows[0];

      const deleteSql = "UPDATE attendance_logs SET deleted = true WHERE id = $1";
      await client.query(deleteSql, [logId]);

      const createSql = `
          INSERT INTO attendance_logs
          (user_id, timestamp, mode, subscribed_by, selected_by, deleted, created_at)
          VALUES ($1, $2, $3, $4, $5, false, $6)
          RETURNING *;
      `;

      const newLogData = [
          originalLog.user_id,
          newTimestamp,
          newMode,
          originalLog.subscribed_by,
          'manual',
          new Date()
      ];

      const { rows } = await client.query(createSql, newLogData);

      await client.query('COMMIT');

      res.status(201).json(rows[0]);

  } catch (err) {
      // --- エラー発生 (ロールバック) ---
      await client.query('ROLLBACK');
      console.error('Log edit transaction error:', err);
      res.status(500).json({ error: 'ログ編集中にサーバーエラーが発生しました' });
  } finally {
      // 接続をプ​​ールに返却
      client.release();
  }
});


// --- サーバーを起動 ---
app.listen(port, () => {
  console.log(`✅ APIサーバー (Express + PostgreSQL) が http://localhost:${port} で起動しました`);
});