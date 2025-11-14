const { app, BrowserWindow, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const net = require('net');
const { spawn } = require('child_process'); // Pythonスクリプトを起動するために使用
const fetch = require('node-fetch');

const API_BASE_URL = '';
const SECRET_KEY = '';

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

/**
 * API通信を集約する関数 (エラーハンドリング強化版)
 * @param {string} url - APIの完全なURL
 * @param {object} options - fetchに渡すオプション (method, bodyなど)
 * @returns {Promise<any|null>} 成功時はJSONデータ、404時はnull
 * @throws {Error} ネットワークエラーや404以外のHTTPエラー
 */
async function apiFetch(url, options = {}) {
  options.headers = {
    ...options.headers,
    'X-API-Key': SECRET_KEY,
    'Content-Type': 'application/json'
  };

  let response;
  try {
    response = await fetch(url, options);

  } catch (error) {
    console.error(`[API Fetch Error] ネットワークエラー: ${error.message}`, { url });
    throw new Error(`API Network Error: ${error.message}`);
  }

  if (!response.ok) {
    if (response.status === 404) {
      console.warn(`[API Not Found] 404: ${url}`);
      return null;
    }

    let errorDetails = response.statusText;
    try {
      const errorData = await response.json();
      errorDetails = errorData.error || errorDetails;
    } catch (e) {
    }

    console.error(`[API HTTP Error] ${response.status} ${errorDetails}`, { url });
    throw new Error(`API Error (${response.status}): ${errorDetails}`);
  }

  try {
    return await response.json();
  } catch (e) {
    return null; 
  }
}

async function fetchUserByStudentNumber(studentNumber) {
  const response = await apiFetch(`${API_BASE_URL}/users/student/${studentNumber}`);
  return response;
}

async function fetchLatestLogByUserId(userId, startOfDay, endOfDay) {
  const response = await apiFetch(`${API_BASE_URL}/attendance/latest/${userId}?start=${startOfDay}&end=${endOfDay}`);
  return response;
}

async function saveAttendanceLogApi(student_id, mode, subscribedBy, selectedBy) {
  const response = await apiFetch(`${API_BASE_URL}/attendance`, {
      method: 'POST',
      body: JSON.stringify({
        student_id: student_id,
        mode: mode,
      }),
    });
  return response;
}

async function saveUserApi(userData) {
  const response = await apiFetch(`${API_BASE_URL}/users`, {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  return response;
}

async function editLogApi(logData) {
  const response = await apiFetch(`${API_BASE_URL}/attendance/edit`, {
      method: 'PUT',
      body: JSON.stringify(logData),
    });
  return response;
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
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji,
                name_kana: pyData.name_kana,
                mode: attendanceMode,
              };

              timeout = setTimeout(async () => {
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
              mainWindow.webContents.send('main-result', false, 'API OR DATABASE ERROR');
              isWaitingForCard = true;
            }
          }
          pyData = null;
        } else if (cardDataMode === 'auth-mode') {
          isWaitingForCard = false;
          if (pyData && pyData.student_number) {
            try {
              const userRow = await fetchUserByStudentNumber(pyData.student_number);

              if (!userRow) {
                mainWindow.webContents.send('auth-result', false, 'USER NOT FOUND');
                return;
              }
              mainWindow.webContents.send('auth-result', true, {
                student_number: userRow.student_number,
                name_kanji: userRow.name_kanji,
              });
            } catch (err) {
              mainWindow.webContents.send('auth-result', false, 'API OR DATABASE ERROR');
            }
            cardDataMode = null;
            isWaitingForCard = false;
            pyData = null;
          }
        } else if (cardDataMode === 'save-user') {
          isWaitingForCard = false;
          if (pyData && pyData.student_number) {
            try {
              const result = await saveUserApi(pyData);

              if (result) {
                mainWindow.webContents.send('save-result', true, result);
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
        } else if (cardDataMode === 'log-mode') { // timeoutを設定したほうがいいかも(今はタブリロードで消える)
          isWaitingForCard = false;
          let pyDataForTimeout = {
                student_number: pyData.student_number,
                name_kanji: pyData.name_kanji,
                name_kana: pyData.name_kana,
              };
          if (pyDataForTimeout && pyDataForTimeout.student_number) {
            try {
              let response = {};
              response.logs = await apiFetch(`${API_BASE_URL}/attendance/student/${pyDataForTimeout.student_number}`);

              if (!response) {
                mainWindow.webContents.send('log-result', false, 'USER NOT FOUND'); // 失敗したときの書き方を変えるべきかも
                return;
              } else {
                response.studentName = pyData.name_kanji || '不明なユーザー';
                mainWindow.webContents.send('log-result', true, response);
              }
              isWaitingForCard = true;
            } catch (err) {
              console.error('Error fetching user by student number:', err);
              mainWindow.webContents.send('log-result', false, 'API OR DATABASE ERROR');
            }
          }
          pyData = null;
        }
      }
    });

    ipcMain.on('cancel-attendance', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    ipcMain.on('assign-user', async () => {
      clearTimeout(timeout);
      try {
        if (pyData && pyData.student_number) {
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

    ipcMain.on('cancel-assign-user', () => {
      clearTimeout(timeout);
      pyData = null;
      isWaitingForCard = true;
    });

    ipcMain.on('select-attendance-mode', async (event, { mode, student_number }) => {
      clearTimeout(timeout);
      try {
        const userRow = await fetchUserByStudentNumber(student_number);

        if (!userRow) {
          mainWindow.webContents.send('main-result', false, 'USER NOT FOUND');
          return;
        }

        await saveAttendanceLogApi(student_number, mode, 'card', 'manual');

        mainWindow.webContents.send('main-result', true, {
          student_number,
          name_kanji: userRow.name_kanji,
          name_kana: userRow.name_kana,
          mode,
        });
      } catch (err) {
        console.error('Error saving attendance log:', err);
        mainWindow.webContents.send('main-result', false, 'API OR DATABASE ERROR');
      } finally {
        isWaitingForCard = true;
      }
    });

    socket.on('close', (err) => {
      console.log('Client disconnected:', socket.remoteAddress);
      connections = connections.filter((conn) => conn !== socket);
      connectionStatus = '未接続';
      updateConnectionStatus();
      if (err) {
        handleReconnect(); // 再接続を試行
      }
    });

    socket.on('error', (err) => {
      console.error('Socket error:', err);
    });

    connections.push(socket);
  });

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

  server.on('error', (err) => {
    console.error('Server error:', err);
  });

  server.on('connection', (socket) => {
    connectionStatus = '稼働中';
    updateConnectionStatus();
  });
}

async function fetchAllActiveUsersWithStatus() {
  try {
    const responce = await apiFetch(`${API_BASE_URL}/users/active`);
    return responce;
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
    // mainWindow.webContents.openDevTools();

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

ipcMain.handle('fetch-logs', async (event, page = 0) => {
  if (pyData && pyData.student_number) {
      const studentNumber = pyData.student_number;

      try {
        let response = {};
        response.logs = await apiFetch(`${API_BASE_URL}/attendance/student/${studentNumber}?page=${page}`);
        response.studentName = pyData.name_kanji || '不明なユーザー';
        response.isGlobal = false;
        return response || {};
      } catch (err) {
        console.error(`[fetch-logs] Error: ${err.message}`);
        throw new Error('ログの取得中にサーバーエラーが発生しました。');
      }
    } else {
      try {
        let response = {};
        response.logs = await apiFetch(`${API_BASE_URL}/attendance/recent?page=${page}`);
        response.studentName = 'グローバル';
        response.isGlobal = true;
        return response || {};
      } catch (err) {
        console.error('[fetch-logs] Error:', err.message);
        throw new Error('最新ログの取得中にサーバーエラーが発生しました。');
      }
    }
});

ipcMain.on('edit-log', async (event, logData) => {
  try {
    const result = await editLogApi(logData);
    mainWindow.webContents.send('save-result', result);
  } catch (err) {
    console.error('Error saving log:', err);
    mainWindow.webContents.send('save-result', false);
  }
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

ipcMain.on('on-tab-change', (event, tabNumber) => {
  pyData = null;
  if (tabNumber === 0) {
    isWaitingForCard = true;
    cardDataMode = "main-mode";
  } else if (tabNumber === 1) {
    isWaitingForCard = true;
    cardDataMode = "log-mode";
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