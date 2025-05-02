const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const { getUserIdByStudentNumber, 
  getLatestAttendanceLogById,
  getLatestAttendanceLog, 
  getHasNoAttendanceLogToday,
  saveAttendanceLog, 
  saveUser,
} = require('./scripts/db'); // データベース保存用モジュール
const net = require('net');
const sqlite3 = require('sqlite3').verbose(); // SQLite3モジュール
const { spawn } = require('child_process'); // Pythonスクリプトを起動するために使用
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
let pyData = null; // カードデータ
let cardDataMode = null;
let isAuthrized = false; // 認証できたか
let timeout = null; // タイムアウト用変数

function startTCPServer() {
  server = net.createServer((socket) => {
    // クライアントからデータを受信
    socket.on('data', async (data) => {
      if (!isWaitingForCard) return;
      try {
        const parsedData = JSON.parse(data.toString());
        pyData = parsedData;
      } catch (err) {
        console.error('Error processing client data:', err);
      }

      if (pyData.type === 'card') {
        clearTimeout(timeout);
        if (mainWindow && cardDataMode === 'main-mode') {
          isWaitingForCard = false;

          if (pyData && pyData.student_number) {
            try {
              const userRow = await getUserIdByStudentNumber(pyData.student_number);
              if (!userRow) {
                mainWindow.webContents.send('main-result', false, {
                  name_kanji: pyData.name_kanji,
                });

                timeout = setTimeout(async () => {
                  isWaitingForCard = true;
                }, 5000);
                return;
              }

              const userId = userRow.id;
              const currentDate = new Date().toISOString().split('T')[0];
              const startOfDay = `${currentDate} 00:07:00`;
              const endOfDay = `${new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 06:59:59`;

              const logRow = await getLatestAttendanceLogById(userId, startOfDay, endOfDay);
              mainWindow.webContents.send('card-detected', {
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji,
                name_kana: pyData.name_kana,
                lastMode: logRow && logRow.mode ? logRow.mode : "out",
              });

              let attendanceMode = "in";
              if (logRow){
                if (logRow.mode === 'in') {
                  attendanceMode = "out";
                } else if (logRow.mode === 'out') {
                  attendanceMode = "in";
                } else if (logRow.mode === 'rest') {
                  attendanceMode = "in";
                }
              };
              
              let = pyDataForTimeout = {
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji,
                name_kana: pyData.name_kana,
                mode: attendanceMode,
              };
              
              timeout = setTimeout(async () => {
                await saveAttendanceLog(userId, pyDataForTimeout.mode, 'card', 'system');
                mainWindow.webContents.send('main-result', true, {
                  student_number: pyDataForTimeout.student_number,
                  name_kanji: pyDataForTimeout.name_kanji,
                  name_kana: pyDataForTimeout.name_kana,
                  mode: pyDataForTimeout.mode,
                });
                isWaitingForCard = true;
              }, 5000);
            } catch (err) {
              console.error('Error processing client data:', err);
              mainWindow.webContents.send('main-result', false, 'DATABASE ERROR');
              isWaitingForCard = true;
            }
          }
        } else if (cardDataMode === 'auth-mode') {
          isWaitingForCard = false;
          // 認証モード
          if (pyData && pyData.student_number) {
            try {
              const userRow = await getUserIdByStudentNumber(pyData.student_number);
              if (!userRow) {
                mainWindow.webContents.send('auth-result', false, 'USER NOT FOUND');
                return;
              }
              mainWindow.webContents.send('auth-result', true, {
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji,
              });
            } catch (err) {
              mainWindow.webContents.send('auth-result', false, 'DATABASE ERROR');
            }
            cardDataMode = null;
            isWaitingForCard = false;
            pyData = null;
          }
        } else if (cardDataMode === 'save-user') {
          isWaitingForCard = false;
          if (pyData && pyData.student_number) {
            try {
              const result = await saveUser(pyData); // db.jsのsaveUser関数を呼び出し
              if (result) {
                mainWindow.webContents.send('save-result', true, pyData); // 保存成功を通知
              } else {
                mainWindow.webContents.send('save-result', false, "Failed to save user"); // 保存失敗を通知
              }
            } catch (err) {
              mainWindow.webContents.send('save-result', false, `Failed to save user: ${err.message || "Unknown error"}`); // 保存失敗を通知
            }
          }
          cardDataMode = null;
          isWaitingForCard = false;
          pyData = null;
        }
      }
    });

    // rendererからのキャンセル処理
    ipcMain.on('cancel-attendance', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    ipcMain.on('assign-user', () => {
      clearTimeout(timeout);
      try {
        if (pyData && pyData.student_number) {
          saveUser(pyData);
          mainWindow.webContents.send('assign-result', true, {
            student_number: pyData.student_number,
            name_kanji: pyData.name_kanji,
            name_kana: pyData.name_kana,
          });
        } else {
          mainWindow.webContents.send('assign-result', false, 'USER NOT FOUND');
        }
      } catch (err) {
        mainWindow.webContents.send('assign-result', false, err.message || 'DATABASE ERROR');
      }
      isWaitingForCard = true;
      pyData = null;
    });

    ipcMain.on('cancel-assign-user', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    // rendererからの選択処理
    ipcMain.on('select-attendance-mode', async (event, { mode, student_number }) => {
      clearTimeout(timeout);
      try {
        const userRow = await getUserIdByStudentNumber(student_number);
        if (!userRow) {
          mainWindow.webContents.send('main-result', false, 'USER NOT FOUND');
          return;
        }

        const userId = userRow.id;
        await saveAttendanceLog(userId, mode, 'card', 'manual');
        mainWindow.webContents.send('main-result', true, {
          student_number,
          name_kanji: pyData.name_kanji,
          name_kana: pyData.name_kana,
          mode,
        });
      } catch (err) {
        console.error('Error saving attendance log:', err);
        mainWindow.webContents.send('main-result', false, 'DATABASE ERROR');
      } finally {
        isWaitingForCard = true;
      }
    });

    // クライアント切断時の処理
    socket.on('close', (err) => {
      console.log('Client disconnected:', socket.remoteAddress);
      connections = connections.filter((conn) => conn !== socket);
      connectionStatus = '未接続';
      updateConnectionStatus();
      if (err) {
        handleReconnect(); // 再接続を試行
      }
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

async function fetchAllActiveUsersWithStatus() {
  const currentDate = new Date().toISOString().split('T')[0];
  const startOfDay = `${currentDate} 00:07:00`;
  const endOfDay = `${new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 06:59:59`;
  try {
    const todayActiveUsers = await getLatestAttendanceLog(startOfDay, endOfDay);
    const noTodayActiveUsers = await getHasNoAttendanceLogToday(startOfDay, endOfDay);
    const todayActiveUsersArray = todayActiveUsers ? [todayActiveUsers] : [];
    const noTodayActiveUsersArray = noTodayActiveUsers || [];

    const noTodayActiveUsersWithStatus = noTodayActiveUsersArray.map((user) => {
      return {
        ...user,
        mode: 'out',
      };
    });
    return [...todayActiveUsersArray, ...noTodayActiveUsersWithStatus];
  } catch (err) {
    console.error('Error fetching users with status:', err);
    throw err;
  }
}

// メインか確認
ipcMain.on('is-main-tab', (event, isMainTab) => {
  if (isMainTab) {
    isWaitingForCard = true;
    cardDataMode = "main-mode";
  } else {
    isWaitingForCard = false;
    cardDataMode = null;
  }
});

// アプリケーションの初期化
app.on('ready', () => {
  try {
    // メインウィンドウを作成
    mainWindow = new BrowserWindow({
      width: 800,
      height: 600,
      // fullscreen: true,
      // frame: false,
      resizable: true,
      alwaysOnTop: true,
      // kiosk: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), // preloadスクリプトを指定
        contextIsolation: true, // 必須
        enableRemoteModule: false, // セキュリティ向上のため無効化
        nodeIntegration: false,
      },
    });

    globalShortcut.register('CommandOrControl+R', () => {
      mainWindow.reload();
    });

    globalShortcut.register('CommandOrControl+Q', () => {
      app.quit();
    });

    globalShortcut.register('CommandOrControl+Shift+R', () => {
      app.relaunch();
      app.quit();
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
      stopPythonScript();
      stopTCPServer();
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
  if (server) {
    server.close(() => {
      console.log('Server closed. Restarting...');
      startTCPServer();
    });
  } else {
    startTCPServer();
  }
});

ipcMain.on('stop-connection', () => {
  stopTCPServer();
  startPythonScript();
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

ipcMain.handle('fetch-active-all-users-with-status', async () => {
  return new Promise(async (resolve, reject) => {
    try {
      const rows = await fetchAllActiveUsersWithStatus();
      resolve(rows);
    } catch (err) {
      console.error('Error fetching active users:', err);
      reject(err);
    }
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

ipcMain.on('cancel-mode', (event) => {
  isWaitingForCard = false;
  cardDataMode = null;
  userData = null;
  if (timeout) {
    clearTimeout(timeout);
    timeout = null;
  }
});