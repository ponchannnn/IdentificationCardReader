let activeInterval;
let users = [];
let isMainTab = true;

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const activeUsersElement = document.getElementById('active-users');
  const logListElement = document.getElementById('log-list');
  const modalElement = document.getElementById('modal');
  const modalContent = document.getElementById('modal-content');
  const statusElement = document.getElementById('status'); // 接続状態を表示する要素
  const mainTabElement = document.getElementById('main-tab'); // メインタブの要素
  const removeUserButton = document.getElementById('remove-user-button'); // ユーザー削除ボタンの要素

  let modalInterval = null;
  let modalTimeout = null;
  let activeUsers;
  let unknownUsersHTML = [];

  // タブの切り替え処理
  tabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      // すべてのタブからアクティブクラスを削除
      tabs.forEach((t) => t.classList.remove('active'));

      // クリックされたタブにアクティブクラスを追加
      tab.classList.add('active');

      // すべてのタブコンテンツを非表示
      tabContents.forEach((content) => content.classList.add('hidden'));

      // 対応するタブコンテンツを表示
      const targetTab = tab.getAttribute('data-tab');
      document.getElementById(targetTab).classList.remove('hidden');

      if(targetTab === 'main') {
        // メインタブが選択された場合の処理
        window.electronAPI.onisMainTab(true);
        activeInterval = setInterval(reloadActiveUsers, 1000);
      }

      // ログタブが選択された場合にデータを取得
      if (targetTab === 'log') {
        window.electronAPI.onisMainTab(false);
        const logListElement = document.getElementById('log-list');
        window.electronAPI.startWaitingForCard();
        toggleModal('カードをタッチしてください...', 5);
        await waitForCard(5);

        if (isWaitingForCard) {
          // カードがタッチされなかった場合の処理
          toggleModal('カードがタッチされませんでした。', 5);
          isWaitingForCard = false;
          window.electronAPI.stopWaitingForCard();
        }
        isWaitingForCard = true; // カード待機状態にする
        window.electronAPI.fetchLogs().then((logs) => {
          window.electronAPI.stopWaitingForCard();
          console.log('Fetched logs:', logs.length);
          logListElement.innerHTML = ''; // 既存のログをクリア
          if (logs.length === 0) {
            logListElement.textContent = 'ログがありません。';
          } else {
            logs.forEach((log) => {
              const logItem = document.createElement('div');
              logItem.textContent = `ID: ${log.id}, 学籍番号: ${log.student_number}, 名前: ${log.name_kanji}, 日付: ${log.created_at}`;
              logListElement.appendChild(logItem);
            });
          }
        }).catch((err) => {
          console.error('Error fetching logs:', err);
          logListElement.textContent = 'ログの取得中にエラーが発生しました。';
        });

      } else if (targetTab === "settings") {
        window.electronAPI.onisMainTab(false);
      }
    });
  });

  function waitForCard(seconds) {
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, seconds * 1000); // 秒をミリ秒に変換
    });
  }

  function updateActiveUsers() {
    // アクティブなユーザーを取得
    return Promise.all([
      window.electronAPI.fetchActiveUsers(),
      window.electronAPI.fetchActiveAllUsers()
    ])
      .then(([fetchedActiveUsers, fetchedUnknownUsers]) => {
        // アクティブなユーザーを表示
        activeUsers = fetchedActiveUsers; // グローバル変数に保存
        const activeUsersHTML = fetchedActiveUsers
          .map((user) => {
            const userClass = user.mode === 'in' ? 'in' : 'out';
            const time = user.mode === 'in' ? `(${getElapsedTime(user.timestamp)})` : '';
            return `
              <div class="user-box ${userClass}">
                <div class="user-name">
                  ${user.name_kanji} (${user.name_kana})
                </div>
                <div class="user-info">
                  学籍番号: ${user.student_number}<br>
                  状態: ${user.mode.toUpperCase()} ${time}
                </div>
              </div>
            `;
          })
          .join('');
  
        // ログがないアクティブなユーザーを表示
        unknownUsersHTML = fetchedUnknownUsers
          .map((user) => {
            return `
              <div class="user-box unknown">
                <div class="user-name">
                  ${user.name_kanji}
                </div>
                <div class="user-name">
                  (${user.name_kana})
                </div>
                <div class="user-info">
                  学籍番号: ${user.student_number}<br>
                  状態: UNKNOWN
                </div>
              </div>
            `;
          })
          .join('');
  
        // 結果を結合して表示
        activeUsersElement.innerHTML = `
          ${activeUsersHTML || ''}
          ${unknownUsersHTML || ''}
        `;
  
        return true; // 成功した場合にtrueを返す
      })
      .catch((err) => {
        console.error('Error fetching active users:', err);
        activeUsersElement.textContent = 'ユーザー情報の取得中にエラーが発生しました。';
        return false; // エラーの場合にfalseを返す
      });
  }
  
  function reloadActiveUsers() {
    const activeUsersHTML = activeUsers
      .map((user) => {
        const userClass = user.mode === 'in' ? 'in' : 'out';
        const time = user.mode === 'in' ? `(${getElapsedTime(user.timestamp)})` : '';
        return `
          <div class="user-box ${userClass}">
            <div class="user-name">
                  ${user.name_kanji}
                </div>
                <div class="user-name">
                  (${user.name_kana})
                </div>
            <div class="user-info">
              学籍番号: ${user.student_number}<br>
              状態: ${user.mode.toUpperCase()} ${time}
            </div>
          </div>
        `;
      })
      .join('');

    activeUsersElement.innerHTML = `
        ${activeUsersHTML || ''}
        ${unknownUsersHTML || ''}
      `;
  }

  function getElapsedTime(timestamp) {
    const now = new Date();
    const inTime = new Date(timestamp);
    const diff = Math.floor((now - inTime) / 1000); // 秒単位の差
    const hours = Math.floor(diff / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    const seconds = diff % 60;
    return `${hours}時間${minutes}分${seconds}秒`;
  }

  // モーダルの表示/非表示を切り替える
  function toggleModal(message = null, autoCloseSeconds = 5) {
    if (modalInterval) {
      clearInterval(modalInterval);
      modalInterval = null;
    }
    if (modalTimeout) {
      clearTimeout(modalTimeout);
      modalTimeout = null;
    }

    if (message) {
      let remainingSeconds = autoCloseSeconds; // 残り秒数を変数に設定

      // メッセージ内の \n を残り秒数に置き換える
      const updateMessage = () => {
        const formattedMessage = message.replace('/n', `${remainingSeconds}`);
        modalContent.innerHTML = `<p>${formattedMessage}</p>`;
      };

      updateMessage(); // 初回メッセージを設定
      modalElement.classList.remove('hidden');

      // 1秒ごとに残り時間を更新
      modalInterval = setInterval(() => {
        remainingSeconds -= 1;
        if (remainingSeconds > 0) {
          updateMessage(); // メッセージを更新
        } else {
          clearInterval(modalInterval); // インターバルをクリア
          modalElement.classList.add('hidden'); // モーダルを閉じる
        }
      }, 1000);

      // 指定された秒数後に自動で閉じる
      modalTimeout = setTimeout(() => {
        clearInterval(modalInterval); // インターバルをクリア
        modalElement.classList.add('hidden'); // モーダルを閉じる
      }, autoCloseSeconds * 1000);
    } else {
      modalElement.classList.add('hidden');
    }
  }

  document.getElementById('add-user').addEventListener('click', async () => {
    try {
      toggleModal('認証用のカードをタッチしてください...(/n)', 5);

      // 認証モードを開始し、結果を取得
      window.electronAPI.setAuthMode()
      window.electronAPI.onAuthResult((event, result) => {
        if (result === false) {
          // 認証失敗の場合
          toggleModal('認証失敗。', 5);
        } else {
          // 認証成功の場合
          const userName = result.name_kanji; // 名前を取得
          toggleModal(`認証成功！${userName} さん`, 1); // 名前を1秒間表示
          // 1秒後に追加処理を実行
          setTimeout(() => {
            toggleModal('追加するカードをタッチしてください...(/n)',5);
            window.electronAPI.saveUser();
            window.electronAPI.onSaveResult((event, result) => {
              if (result === false) {
                toggleModal('ユーザー追加失敗。', 5);
              } else {
                const { student_number, name_kanji, name_kana, birthday, publication_date, expiry_date } = result;
                toggleModal(`
                  <h1>ユーザー追加成功！</h1>
                  <p>学籍番号: ${student_number}</p>
                  <p>名前: ${name_kanji} (${name_kana})</p>
                  <p>生年月日: ${birthday}</p>
                  <p>発行日: ${publication_date}</p>
                  <p>有効期限: ${expiry_date}</p>
                `, 5);
              }
            });
          }, 1000);
        }
      });
    } catch (error) {
      console.error('Error during user addition:', error);
      toggleModal('エラーが発生しました。', 5);
    }
  });

  // 接続開始ボタン
  document.getElementById('start-connection').addEventListener('click', () => {
    isWaitingForCard = true;
    window.electronAPI.startWaitingForCard();
    toggleModal('カードをタッチしてください...');
  });

  // 接続終了ボタン
  document.getElementById('stop-connection').addEventListener('click', () => {
    isWaitingForCard = false;
    window.electronAPI.stopWaitingForCard();
    toggleModal(); // モーダルを閉じる
  });

  // カードデータを受信
  window.electronAPI.onCardData((event, data) => {
    if (isWaitingForCard) {
      isWaitingForCard = false; // 待機状態を解除
      toggleModal(); // モーダルを閉じる

      if (data) {
        // カード情報をモーダルに表示
        modalContent.innerHTML = `
          <h1>${data.name_kanji} (${data.name_kana})</h1>
          <p>学籍番号: ${data.student_number}</p>
          <p>状態: ${data.mode.toUpperCase()}</p>
        `;
        modalElement.classList.remove('hidden');

        // 数秒後に自動で閉じる
        setTimeout(() => {
          modalElement.classList.add('hidden');
        }, 5000);
      } else {
        toggleModal('カードがタッチされませんでした。', 5);
      }
    }
  });

  // 接続状態を更新
  window.electronAPI.onConnectionStatus((event, status) => {
    let statusText = '';
    let statusColor = '';
    let statusEmoji = '';

    switch (status) {
      case '未接続':
        statusText = '未接続';
        statusColor = 'gray';
        statusEmoji = '❌';
        break;
      case '接続中':
        statusText = '接続中';
        statusColor = 'orange';
        statusEmoji = '🔄';
        break;
      case '稼働中':
        statusText = '稼働中';
        statusColor = 'green';
        statusEmoji = '✅';
        break;
      default:
        statusText = '不明';
        statusColor = 'black';
        statusEmoji = '❓';
        break;
    }

    statusElement.textContent = `${statusEmoji} ${statusText}`;
    statusElement.style.color = statusColor;
  });

  // 初回更新
  updateActiveUsers().then((success) => {
    if (success) {
      // 成功した場合にインターバルを設定
      if (activeInterval) {
        clearInterval(activeInterval); // 既存のインターバルをクリア
      }
      activeInterval = setInterval(reloadActiveUsers, 1000);
    }
  });
});