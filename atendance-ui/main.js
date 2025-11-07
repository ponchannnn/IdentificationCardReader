const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process'); // Pythonスクリプトを起動するために使用
const fetch = require('node-fetch');

const API_BASE_URL = '';
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

async function fetchUserByStudentNumber(studentNumber) {
  try {
    const response = await fetch(`${API_BASE_URL}/users/student/${studentNumber}`);
    if (response.status === 404) {
      return null; // ユーザーが見つからない
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('fetchUserByStudentNumber Error:', err);
    throw err;
  }
}

async function fetchLatestLogByUserId(userId, startOfDay, endOfDay) {
  try {
    const response = await fetch(`${API_BASE_URL}/attendance/latest/${userId}?start=${startOfDay}&end=${endOfDay}`);
    if (response.status === 404) {
      return null; // ログが見つからない
    }
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('fetchLatestLogByUserId Error:', err);
    throw err;
  }
}

async function saveAttendanceLogApi(student_id, mode, subscribedBy, selectedBy) {
  try {
    const response = await fetch(`${API_BASE_URL}/attendance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: student_id,
        mode: mode,
      }),
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('saveAttendanceLogApi Error:', err);
    throw err;
  }
}

async function saveUserApi(userData) {
  try {
    const response = await fetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData),
    });
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('saveUserApi Error:', err);
    throw err;
  }
}

function startTCPServer() {
  server = net.createServer((socket) => {
    socket.on('data', async (data) => {
      if (!isWaitingForCard) return;
      try {
        const parsedData = JSON.parse(data.toString());
        pyData = parsedData;
      } catch (err) {
        console.error('Error processing client data:', err);
        return; // パース失敗時は抜ける
      }

      if (pyData.type === 'card') {
        clearTimeout(timeout);
        if (mainWindow && cardDataMode === 'main-mode') {
          isWaitingForCard = false;

          if (pyData && pyData.student_number) {
            try {
              // ★修正: DB直接参照 -> API呼び出し
              const userRow = await fetchUserByStudentNumber(pyData.student_number);
              
              if (!userRow) {
                mainWindow.webContents.send('main-result', false, {
                  name_kanji: pyData.name_kanji,
                });
                timeout = setTimeout(async () => {
                  isWaitingForCard = true;
                }, 5000);
                return;
              }

              const userId = userRow.id; // APIから返されたID (PostgreSQLのID)
              const currentDate = new Date().toISOString().split('T')[0];
              const startOfDay = `${currentDate} 00:07:00`;
              const endOfDay = `${new Date(new Date(currentDate).getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0]} 06:59:59`;

              // ★修正: DB直接参照 -> API呼び出し
              const logRow = await fetchLatestLogByUserId(userId, startOfDay, endOfDay);
              
              mainWindow.webContents.send('card-detected', {
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji, // pyData (カード情報)
                name_kana: pyData.name_kana, // pyData (カード情報)
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
              
              let pyDataForTimeout = {
                student_number: pyData.student_number, // ★ APIが student_id を要求するため
                name_kanji: pyData.name_kanji,
                name_kana: pyData.name_kana,
                mode: attendanceMode,
              };
              
              timeout = setTimeout(async () => {
                // ★修正: DB直接保存 -> API呼び出し
                await saveAttendanceLogApi(pyDataForTimeout.student_number, pyDataForTimeout.mode, 'card', 'system');
                
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
              mainWindow.webContents.send('main-result', false, 'API OR DATABASE ERROR'); // ★エラーメッセージ変更
              isWaitingForCard = true;
            }
          }
        } else if (cardDataMode === 'auth-mode') {
          isWaitingForCard = false;
          if (pyData && pyData.student_number) {
            try {
              // ★修正: DB直接参照 -> API呼び出し
              const userRow = await fetchUserByStudentNumber(pyData.student_number);
              
              if (!userRow) {
                mainWindow.webContents.send('auth-result', false, 'USER NOT FOUND');
                return;
              }
              mainWindow.webContents.send('auth-result', true, {
                student_number: userRow.student_number,
                name_kanji: userRow.name_kanji, // ★APIから取得した名前
              });
            } catch (err) {
              mainWindow.webContents.send('auth-result', false, 'API OR DATABASE ERROR'); // ★エラーメッセージ変更
            }
            cardDataMode = null;
            isWaitingForCard = false;
            pyData = null;
          }
        } else if (cardDataMode === 'save-user') {
          isWaitingForCard = false;
          if (pyData && pyData.student_number) {
            try {
              // ★修正: DB直接保存 -> API呼び出し
              const result = await saveUserApi(pyData); // pyData (NFCから読んだデータ) をAPIに渡す
              
              if (result) {
                mainWindow.webContents.send('save-result', true, result); // ★APIからの返り値(登録後のユーザー情報)
              } else {
                mainWindow.webContents.send('save-result', false, "Failed to save user via API");
              }
            } catch (err) {
              mainWindow.webContents.send('save-result', false, `Failed to save user: ${err.message || "Unknown error"}`);
            }
          }
          cardDataMode = null;
          isWaitingForCard = false;
          pyData = null;
        }
      }
    });

    // --- ipcMain ハンドラ (API呼び出しに修正) ---

    // rendererからのキャンセル処理 (変更なし)
    ipcMain.on('cancel-attendance', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    ipcMain.on('assign-user', async () => { // ★ async に変更
      clearTimeout(timeout);
      try {
        if (pyData && pyData.student_number) {
          // ★修正: DB直接保存 -> API呼び出し
          const savedUser = await saveUserApi(pyData);
          
          mainWindow.webContents.send('assign-result', true, {
            student_number: savedUser.student_number,
            name_kanji: savedUser.name_kanji,
            name_kana: savedUser.name_kana,
          });
        } else {
          mainWindow.webContents.send('assign-result', false, 'USER DATA NOT FOUND');
        }
      } catch (err) {
        mainWindow.webContents.send('assign-result', false, err.message || 'API OR DATABASE ERROR');
      }
      isWaitingForCard = true;
      pyData = null;
    });

    // (変更なし)
    ipcMain.on('cancel-assign-user', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    ipcMain.on('select-attendance-mode', async (event, { mode, student_number }) => {
      clearTimeout(timeout);
      try {
        // ★修正: DB直接参照 -> API呼び出し
        const userRow = await fetchUserByStudentNumber(student_number);
        
        if (!userRow) {
          mainWindow.webContents.send('main-result', false, 'USER NOT FOUND');
          return;
        }

        // ★修正: DB直接保存 -> API呼び出し
        // saveAttendanceLogApi は student_id を想定しているため
        await saveAttendanceLogApi(student_number, mode, 'card', 'manual');
        
        mainWindow.webContents.send('main-result', true, {
          student_number,
          name_kanji: userRow.name_kanji, // ★ APIから取得した情報
          name_kana: userRow.name_kana, // ★ APIから取得した情報
          mode,
        });
      } catch (err) {
        console.error('Error saving attendance log:', err);
        mainWindow.webContents.send('main-result', false, 'API OR DATABASE ERROR');
      } finally {
        isWaitingForCard = true;
      }
    });
    
    // クライアント切断時の処理 (変更なし)
    socket.on('close', (err) => {
      console.log('Client disconnected:', socket.remoteAddress);
      connections = connections.filter((conn) => conn !== socket);
      connectionStatus = '未接続';
      updateConnectionStatus();
      if (err) {
        handleReconnect(); // 再接続を試行
      }
    });

    // エラー処理 (変更なし)
    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    // 接続を管理 (変更なし)
    connections.push(socket);
  }); // server = net.createServer の終わり

  // サーバーを指定ポートで開始 (変更なし)
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

  // サーバーエラー処理 (変更なし)
  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  // サーバー接続時の処理 (変更なし)
  server.on('connection', (socket) => {
    connectionStatus = '稼働中';
    updateConnectionStatus();
  });
}

async function fetchAllActiveUsersWithStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/users/active`);
    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('fetchAllActiveUsersWithStatus Error:', err);
    throw err;
  }
}

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
  return new Promise(async (resolve, reject) => {
    if (userData && userData.student_number) {
      const studentNumber = userData.student_number;
      console.log(`Fetching logs for Student Number: ${studentNumber}`);
    
      try {
        const response = await fetch(`${API_BASE_URL}/attendance/student/${studentNumber}`);
        if (!response.ok) {
          throw new Error(`API Error: ${response.statusText}`);
        }
        const logs = await response.json();
        resolve(logs);
      } catch (err) {
        reject(err);
      }
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