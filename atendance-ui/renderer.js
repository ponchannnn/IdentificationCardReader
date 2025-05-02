let activeInterval;
let users = [];
let isMainTab = true;

document.addEventListener('DOMContentLoaded', () => {
  const tabs = document.querySelectorAll('.tab');
  const tabContents = document.querySelectorAll('.tab-content');
  const activeUsersElement = document.getElementById('active-users');
  const logListElement = document.getElementById('log-list');
  const statusElement = document.getElementById('status'); // 接続状態を表示する要素

  let modalInterval = null;
  let knownUsers;
  let unknownUsersHTML = [];
  let updateButtonEventFunction = null;

  window.electronAPI.onIsMainTab(true);

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
        window.electronAPI.onIsMainTab(true);
        updateActiveUsers().then((success) => {
          if (success) {
            // 成功した場合にインターバルを設定
            if (activeInterval) {
              clearInterval(activeInterval); // 既存のインターバルをクリア
            }
            activeInterval = setInterval(reloadActiveUsers, 1000);
          }
        }).catch(() => {
          activeUsersElement.textContent = 'ユーザー情報の取得中にエラーが発生しました。'
        });
      }

      // ログタブが選択された場合にデータを取得
      if (targetTab === 'log') {
        window.electronAPI.onIsMainTab(false);
        const logListElement = document.getElementById('log-list');
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
        window.electronAPI.onIsMainTab(false);
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
    return window.electronAPI.fetchActiveAllUsers()
      .then((fetchedActiveUsers) => {
        // アクティブなユーザーを表示
        knownUsers = fetchedActiveUsers.filter((user) => user.mode !== 'unknown') || [];
        const unknownUsers = fetchedActiveUsers.filter((user) => user.mode === 'unknown') || [];
        const activeUsersHTML = knownUsers
          .map((user) => {
            const userClass = user.mode;
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
  
        // ログがないアクティブなユーザーを表示
        unknownUsersHTML = unknownUsers
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
  
        return true;
      })
      .catch((err) => {
        console.error('Error fetching active users:', err);
        activeUsersElement.textContent = 'ユーザー情報の取得中にエラーが発生しました。';
        return false; // エラーの場合にfalseを返す
      });
  }
  
  function reloadActiveUsers() {
    const activeUsersHTML = knownUsers
      .map((user) => {
        const userClass = user.mode;
        const time = user.mode === 'in' || user.mode === 'rest' ? `(${getElapsedTime(user.timestamp)})` : '';
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
  function toggleModal(message = null, autoCloseSeconds = 5, onCancel = null, hasButton = false) {
    const modalElement = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalCloseButton = document.getElementById('modal-close');

    const closeModal = () => {
      modalElement.classList.remove('show');
      if (modalInterval) clearInterval(modalInterval);
      modalInterval = null;
      if (onCancel) window.electronAPI.cancelMode();
      updateButtonEventFunction = null;
      modalCloseButton.onclick = null;
    };

    if (modalInterval) {console.log(message, modalInterval);
      clearInterval(modalInterval);
      modalInterval = null;
    }

    modalCloseButton.onclick = closeModal;

    if (message) {
      if (autoCloseSeconds && autoCloseSeconds > 0) {
        let remainingSeconds = autoCloseSeconds; // 残り秒数を変数に設定

        // メッセージ内の /n を残り秒数に置き換える
        const updateMessage = () => {
          const formattedMessage = message.replace(/\/n/g, `${remainingSeconds}`);
          modalBody.innerHTML = `<p>${formattedMessage}</p>`;
          if (hasButton && typeof updateButtonEventFunction === 'function') {
            updateButtonEventFunction();
          }
        };
        // 1秒ごとに残り時間を更新
        modalInterval = setInterval(() => {
          remainingSeconds -= 1;
          if (remainingSeconds > 0) {
            updateMessage(); // メッセージを更新
          } else {
            closeModal();
          }
        }, 1000);
        updateMessage(); // 初回メッセージを設定
      }
      modalElement.classList.add('show');
    } else {
      closeModal();
    }
  }

  function updateDateTime() {
    const dateTimeElement = document.getElementById('current-datetime');
    if (dateTimeElement) {
      const now = new Date();
      const formattedDateTime = now.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      dateTimeElement.textContent = formattedDateTime;
    }
  }

  window.electronAPI.onCardDetected((event, cardData) => {
    let modeColor = '';
    let modeTitle = '';
    switch (cardData.lastMode) {
      case 'in':
        modeColor = 'red';
        modeTitle = '退室';
        break;
      case 'out':
        modeColor = 'green';
        modeTitle = '入室';
        break;
      case 'rest':
        modeColor = 'green';
        modeTitle = '入室';
        break;
      default:
        modeColor = 'gray';
        modeTitle = '不明';
        break;
    }

    updateButtonEventFunction = () => {
      document.getElementById('cancel-button').addEventListener('click', () => {
        window.electronAPI.CancelAttendance();
        toggleModal();
      });
    
      if (cardData.lastMode === 'in') {
        document.getElementById('rest-button').addEventListener('click', () => {
          window.electronAPI.SelectAttendanceMode({ mode: 'rest', student_number: cardData.student_number });
          toggleModal();
        });
        document.getElementById('out-button').addEventListener('click', () => {
          window.electronAPI.SelectAttendanceMode({ mode: 'out', student_number: cardData.student_number });
          toggleModal();
        });
      } else if (cardData.lastMode === 'out') {
        document.getElementById('in-button').addEventListener('click', () => {
          window.electronAPI.SelectAttendanceMode({ mode: 'in', student_number: cardData.student_number });
          toggleModal();
        });
      } else if (cardData.lastMode === 'rest') {
        document.getElementById('in-button').addEventListener('click', () => {
          window.electronAPI.SelectAttendanceMode({ mode: 'in', student_number: cardData.student_number });
          toggleModal();
        });
    
        document.getElementById('out-button').addEventListener('click', () => {
          window.electronAPI.SelectAttendanceMode({ mode: 'out', student_number: cardData.student_number });
          toggleModal();
        });
      }
    };

    toggleModal(`
      <h1 style="color: ${modeColor};">${modeTitle}しますか?(/n)</h1>
      <p color=gray>/n秒後自動で${modeTitle}</p>
      <p></p>
      <h2>${cardData.name_kanji}</h2>
      <p>(${cardData.name_kana})</p>
      <p>学籍番号: ${cardData.student_number}</p>
      ${cardData.lastMode === 'in' ? `
        <button id="rest-button" class="btn">休憩</button>
        <button id="out-button" class="btn">退出</button>
      ` : cardData.lastMode === 'out' ? `
        <button id="in-button" class="btn">入室</button>
      ` : cardData.lastMode === 'rest' ? `
        <button id="in-button" class="btn">入室</button>
        <button id="out-button" class="btn">退出</button>
      ` : ''}
      <button id="cancel-button" class="btn">キャンセル</button>
    `, 5, undefined, true);
  });

  document.getElementById('add-user').addEventListener('click', async () => {
    try {
      toggleModal('認証用のカードをタッチしてください...(/n)', 5, true);

      // 認証モードを開始し、結果を取得
      window.electronAPI.setAuthMode()
      window.electronAPI.onAuthResult((event, result) => {
        if (result === false) {
          // 認証失敗の場合
          toggleModal('認証失敗。', 5);
        } else {
          // 認証成功の場合
          const userName = result.name_kanji; // 名前を取得
          toggleModal(`認証成功！${userName} さん`, 2); // 名前を1秒間表示
          // 1秒後に追加処理を実行
          setTimeout(() => {
            toggleModal('追加するカードをタッチしてください...(/n)',5, true);
            window.electronAPI.saveUser();
            window.electronAPI.onSaveResult((event, result, message) => {
              if (!result) {
                toggleModal('ユーザー追加失敗。', 5);
              } else {
                const { student_number, name_kanji, name_kana, birthday, publication_date, expiry_date } = message;
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
    window.electronAPI.startConnection();
    toggleModal('再接続中...', 5);
  });

  // 接続終了ボタン
  document.getElementById('stop-connection').addEventListener('click', () => {
    window.electronAPI.stopConnection();
    toggleModal('接続を終了しました。', 5);
  });

  // カードデータを受信
  window.electronAPI.onMainResult((event, success, message) => {
    if (!success) {
      updateButtonEventFunction = () => {
        document.getElementById('assign-button').addEventListener('click', () => {
          window.electronAPI.AssignUser();
          toggleModal('登録中...', 5);
        });
        document.getElementById('cancel-assign-button').addEventListener('click', () => {
          window.electronAPI.CancelAssignUser();
          toggleModal();
        });
      };
  
      toggleModal(`
      <h2 style="color: red;">登録されていないカードです!</h2>
      <p>名前: ${message.name_kanji}</p>
      <p>登録しますか?(/n)</p>
      <button id="assign-button" class="btn">登録</button>
      <button id="cancel-assign-button" class="btn">キャンセル</button>
      `, 5, undefined, true);
      return;
    }

    const { student_number, name_kanji, name_kana, mode } = message;

    // モードに応じた色とタイトルを設定
    let modeColor = '';
    let modeTitle = '';
    switch (mode) {
      case 'in':
        modeColor = 'green';
        modeTitle = '入室';
        break;
      case 'out':
        modeColor = 'red';
        modeTitle = '退室';
        break;
      case 'rest':
        modeColor = 'orange';
        modeTitle = '休憩';
        break;
      default:
        modeColor = 'gray';
        modeTitle = '不明';
        break;
    }

    toggleModal(`
      <h1 style="color: ${modeColor};">${modeTitle}</h1>
      <h2>${name_kanji}</h2>
      <p>(${name_kana})</p>
      <p>学籍番号: ${student_number}</p>
    `, 5);
    updateActiveUsers();
  });

  window.electronAPI.onShowModal((type, message) => {
    toggleModal(type, null, message);
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

  window.electronAPI.onAssignResult((event, success, message) => {
    if (success) {
      toggleModal(`
        <h1>登録成功！</h1>
        <p>学籍番号: ${message.student_number}</p>
        <p>名前: ${message.name_kanji} (${message.name_kana})</p>
        <p>入室する場合はもう一度タッチしてください。</p>
      `, 5);
    } else {
      toggleModal(`
        <h1>登録失敗！</h1>
        <p>${message}</p>
        `, 5);
    }
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

  updateDateTime();
  setInterval(updateDateTime, 1000);
});