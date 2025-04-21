const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { saveAttendanceLog } = require('./scripts/db'); // データベース保存用モジュール
const net = require('net');
const sqlite3 = require('sqlite3').verbose(); // SQLite3モジュール
const { spawn } = require('child_process'); // Pythonスクリプトを起動するために使用
const { start } = require('repl');
const db = new sqlite3.Database('./scripts/card_logs.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to the SQLite database.');
  }
});

let mainWindow;
let server; // TCPサーバー
let connections = []; // 接続中のクライアントを管理
let reconnectAttempts = 0; // 再接続試行回数
const MAX_RECONNECT_ATTEMPTS = 5; // 最大再接続試行回数
const RECONNECT_INTERVAL = 10000; // 再接続間隔（ミリ秒）
let pythonProcess = null; // Pythonスクリプトのプロセス
let connectionStatus = '未接続'; // 接続状態
let isWaitingForCard = false; // カード待機状態
let userData = null; // カードデータ
let cardDataMode = null;
let isAuthrized = false; // 認証できたか
let timeout = null; // タイムアウト用変数

function startTCPServer() {
  server = net.createServer((socket) => {
    // クライアントからデータを受信
    socket.on('data', (data) => {
      clearTimeout(timeout);
      if (!isWaitingForCard) {
        return;
      }
      try {
        const parsedData = JSON.parse(data.toString());
        userData = parsedData;
        console.log('Received card data from client:', parsedData);

        // レンダラープロセスにデータを送信
        if (mainWindow) {
          mainWindow.webContents.send('card-data', parsedData);
        }
      } catch (err) {
        console.error('Error processing client data:', err);
      }

      if (cardDataMode === 'main-mode') {
        isWaitingForCard = false;
        // メインモード
        if (userData && userData.student_number) {
          try {
            // ユーザーが存在するか確認
            db.get(
              `SELECT id FROM users WHERE student_number = ?`,
              [userData.student_number],
              (err, userRow) => {
                if (err) {
                  console.error('Error checking user existence:', err);
                  mainWindow.webContents.send('main-result', false, 'DATABASE ERROR');
                  return;
                }

                if (!userRow) {
                  // ユーザーが存在しない場合
                  console.log('User not found.');
                  mainWindow.webContents.send('main-result', false, 'USER NOT FOUND');
                  return;
                }

                const userId = userRow.id; // user_idを取得
                const currentDate = new Date().toISOString().split('T')[0]; // 今日の日付を取得 (YYYY-MM-DD形式)
                const startOfDay = `${currentDate} 00:00:00`; // 当日の開始時刻
                const endOfDay = `${currentDate} 23:59:59`; // 当日の終了時刻

                // その日の最新ログを取得
                db.get(
                  `SELECT mode, timestamp FROM attendance_logs
                   WHERE user_id = ? AND timestamp >= ? AND timestamp <= ?
                   ORDER BY timestamp DESC LIMIT 1`,
                  [userId, startOfDay, endOfDay],
                  (err, logRow) => {
                    if (err) {
                      console.error('Error fetching latest attendance log:', err);
                      mainWindow.webContents.send('main-result', false, 'DATABASE ERROR');
                      return;
                    }

                    let newMode = 'in'; // デフォルトはin
                    if (logRow) {
                      // 最新のログが存在する場合、modeを切り替える
                      newMode = logRow.mode === 'in' ? 'out' : 'in';
                    }

                    // 新しいログを挿入
                    db.run(
                      `INSERT INTO attendance_logs (user_id, mode, timestamp)
                       VALUES (?, ?, ?)`,
                      [userId, newMode, new Date().toISOString()],
                      (err) => {
                        if (err) {
                          console.error('Error saving attendance log to database:', err);
                          mainWindow.webContents.send('main-result', false, 'DATABASE ERROR');
                        } else {
                          console.log(`Attendance log saved to database successfully with mode: ${newMode}`);
                          mainWindow.webContents.send('main-result', true, newMode);
                        }
                      }
                    );
                  }
                );
              }
            );
          } catch (err) {
            console.error('Error processing client data:', err);
            mainWindow.webContents.send('main-result', false, 'UNKNOWN ERROR');
          }
        }
      } else if (cardDataMode === 'auth-mode') {
        isWaitingForCard = false;
        // 認証モード
        if (userData && userData.student_number) {
          try {
            // データベースでユーザーを確認
            db.get(
              `SELECT * FROM users WHERE student_number = ?`,
              [userData.student_number],
              (err, row) => {
                if (err) {
                  console.error('Error querying database:', err);
                  mainWindow.webContents.send('auth-result', false); // 認証失敗を通知
                } else if (row) {
                  mainWindow.webContents.send('auth-result', row); // 認証成功を通知
                  isAuthrized = true;
                } else {
                  console.log('User is not authorized.');
                  mainWindow.webContents.send('auth-result', false); // 認証失敗を通知
                }
              }
            );
          } catch (err) {
            console.error('Error processing client data:', err);
          }
          cardDataMode = null;
          isWaitingForCard = false;
          userData = null;
        }
      } else if (cardDataMode === 'save-user') {
        
        if (userData && userData.student_number) {
          try {
            // データベースにユーザーを保存
            db.run(
              `INSERT INTO users (student_number, name_kanji, name_kana, birthday, publication_date, expiry_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                userData.student_number,
                userData.name_kanji,
                userData.name_kana,
                userData.birthday,
                userData.publication_date,
                userData.expiry_date,
                new Date().toISOString(),
              ],
              (err) => {
                if (err) {
                  mainWindow.webContents.send('save-result', false); // 保存失敗を通知
                  console.error('Error saving user to database:', err);
                } else {
                  console.log('User saved to database successfully.');
                  mainWindow.webContents.send('save-result', userData); // 保存成功を通知
                }
              }
            );
          } catch (err) {
            console.error('Error processing client data:', err);
          }
        }
        cardDataMode = null;
        isWaitingForCard = false;
        userData = null;
      }
    });
    
    // クライアント切断時の処理
    socket.on('close', () => {
      console.log('Client disconnected:', socket.remoteAddress);
      connections = connections.filter((conn) => conn !== socket);
      connectionStatus = '未接続';
      updateConnectionStatus();
      handleReconnect(); // 再接続を試行
    });

    // エラー処理
    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    // 接続を管理
    connections.push(socket);
  });

  // サーバーを指定ポートで開始
  server.listen(65432, '127.0.0.1', () => {
    console.log('TCP server listening on 127.0.0.1:65432');
    setTimeout(() => {
      if (server.listening) {
        connectionStatus = '接続中';
        updateConnectionStatus();
      } else {
        connectionStatus = '未接続';
        updateConnectionStatus();
      }
    }, 1000);

    setTimeout(() => {
      startPythonScript()
    }, 4000);
  });

  // サーバーエラー処理
  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  // サーバー接続時の処理
  server.on('connection', (socket) => {
    isWaitingForCard = false;
    connectionStatus = '稼働中';
    updateConnectionStatus();
  });
}
  
// サーバーを安全に閉じる
function stopTCPServer() {
  if (server) {
    console.log('Closing TCP server...');
    connections.forEach((socket) => socket.destroy()); // すべてのクライアント接続を閉じる
    server.close(() => {
      console.log('TCP server closed.');
    });
  }
}

// 再接続を試行
function handleReconnect() {
  if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
    reconnectAttempts++;
    console.log(`Reconnection attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}...`);
    setTimeout(() => {
      stopPythonScript()
      startPythonScript();
    }, RECONNECT_INTERVAL);
  } else {
    console.log('Max reconnection attempts reached. Starting Python script...');
    stopTCPServer();
    startTCPServer();
  }
}

// Pythonスクリプトを起動
function startPythonScript() {
  if (pythonProcess) {
    console.log('Python script is already running.');
    return;
  }

  pythonProcess = spawn('python', ['./scripts/nfc-watcher.py'], {
    stdio: 'inherit', // Pythonスクリプトの出力を継承
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python script exited with code ${code}`);
    pythonProcess = null;
  });

  pythonProcess.on('error', (err) => {
    console.error('Failed to start Python script:', err);
  });
}

// Pythonスクリプトを停止
function stopPythonScript() {
  if (pythonProcess) {
    pythonProcess.kill();
    console.log('Python script stopped.');
    pythonProcess = null;
  }
}

// 接続状態をUIに反映
function updateConnectionStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('connection-status', connectionStatus);
  }
}

// メインか確認
function isMainTab() {
  if (mainWindow) {
    mainWindow.webContents.send('is-main-tab', true);
  }
}

// アプリケーションの初期化
app.on('ready', () => {
  try {
    // メインウィンドウを作成
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), // preloadスクリプトを指定
        contextIsolation: true, // 必須
        enableRemoteModule: false, // セキュリティ向上のため無効化
      },
    });

    // アプリのUIをロード
    mainWindow.loadFile('./public/index.html').catch((err) => {
      console.error('Failed to load UI:', err);
    });

    // TCPサーバーを開始
    startTCPServer();

    // 開発者ツールを開く（必要に応じてコメントアウト）
    mainWindow.webContents.openDevTools();

    // アプリ終了時にサーバーとPythonスクリプトを閉じる
    app.on('before-quit', () => {
      stopTCPServer();
      stopPythonScript();
    });
  } catch (err) {
    console.error('Error during app initialization:', err);
  }
});

// アプリケーションがすべてのウィンドウを閉じたときの処理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('start-connection', () => {
  console.log('Manual connection start requested.');
  startTCPServer();
  connectionStatus = '稼働中';
  updateConnectionStatus();
});

ipcMain.on('stop-connection', () => {
  console.log('Manual connection stop requested.');
  stopTCPServer();
  connectionStatus = '未接続';
  updateConnectionStatus();
});

ipcMain.on('save-user', () => {
  if (!isAuthrized) {
    mainWindow.webContents.send('save-result', false); // 保存失敗を通知
  }
  isAuthrized = false;
  cardDataMode = 'save-user';
  isWaitingForCard = true;

  timeout = setTimeout(() => {
    cardDataMode = null;
    isWaitingForCard = false;
    if (!isAuthrized) {
      mainWindow.webContents.send('save-result', false); // 保存失敗を通知
    }
  }, 5000);
});

ipcMain.on('auth-mode', () => {
  cardDataMode = 'auth-mode';
  isWaitingForCard = true;
  isAuthrized = true;

  timeout = setTimeout(() => {
    cardDataMode = null;
    isWaitingForCard = false;
    if (!isAuthrized) {
      mainWindow.webContents.send('auth-result', false); // 認証失敗を通知
    }
  }, 5000);
});

ipcMain.handle('fetch-logs', async () => {
  return new Promise((resolve, reject) => {
    if (userData && userData.student_number) {
      const studentNumber = userData.student_number;
      console.log(`Student Number: ${studentNumber}`);
    
      // 必要に応じて、studentNumberを使用して処理を追加
      db.all(
        `SELECT al.id, al.timestamp, al.mode, u.student_number, u.name_kanji, u.name_kana
         FROM attendance_logs al
         INNER JOIN users u ON al.user_id = u.id
         WHERE u.student_number = ?
         ORDER BY al.timestamp DESC`,
        [studentNumber],
        (err, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows);
          }
        }
      );
    } else {
      console.log('No valid userData or student_number found.');
      resolve([]);
    }
  });
});

ipcMain.handle('fetch-active-users', async () => {
  return new Promise((resolve, reject) => {
    db.all( // 各ユーザーの最新の出席ログらしい by chatGPT
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
          console.error('Error fetching active users:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
});

ipcMain.handle('fetch-active-all-users', async () => {
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
          console.error('Error fetching active users without logs:', err);
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
});

ipcMain.handle('save-user', async (event, user) => {
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
          console.error('Error saving user to database:', err);
          reject(err);
        } else {
          console.log('User saved to database with ID:', this.lastID);
          resolve({ success: true });
        }
      }
    );
  });
});

ipcMain.on('is-main-tab', (event, isMainTab) => {
  if (isMainTab) {
    isWaitingForCard = true;
    cardDataMode = "main-mode";
  } else {
    isWaitingForCard = false;
    cardDataMode = null;
  }
});