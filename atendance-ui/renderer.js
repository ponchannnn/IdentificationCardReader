let activeInterval;
let users = [];

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

  window.electronAPI.onTabChange(0);

  // タブの切り替え処理
  tabs.forEach((tab) => {
    tab.addEventListener('click', async () => {
      tabs.forEach((t) => t.classList.remove('active'));

      tab.classList.add('active');

      tabContents.forEach((content) => content.classList.add('hidden'));

      const targetTab = tab.getAttribute('data-tab');
      document.getElementById(targetTab).classList.remove('hidden');

      if(targetTab === 'main') {
        window.electronAPI.onTabChange(0);
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

      if (targetTab === 'log') {
        window.electronAPI.onTabChange(1);
        fetchAndDisplayLogs(0);

      } else if (targetTab === "settings") {
        window.electronAPI.onTabChange(2);
      }
    });
  });

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

  async function fetchAndDisplayLogs(page = 0) {
    if (!logListElement) return;
    logListElement.innerHTML = '<p>最新のログを取得中...</p>';

    try {
        const response = await window.electronAPI.fetchLogs(page);
        renderLogList(response.logs, response.studentName, false, page);
    } catch (err) {
        console.error('Error fetching logs:', err);
        logListElement.innerHTML = `<p style="color: red;">ログの取得に失敗しました: ${err.message}</p>`;
    }
  }

  function renderLogList(logs, title = '', hasEditButton = false, page = 0) {
      setPageToURL(page);
      if (!logListElement) return;

      if (!logs || logs.length === 0) {
          logListElement.innerHTML = `<h3>${title}</h3><p>ログはまだありません。</p>`;
          return;
      }

      logListElement.innerHTML = `
        <h3>${title}</h3>
        <p>ページ: ${page + 1}</p>
        <button id="prev-page" class="btn btn-small" disabled>←</button>
        <button id="next-page" class="btn btn-small">→</button>
        <table class="log-table">
          <thead>
            <tr>
              <th>日時</th>
              <th>名前 (学籍番号)</th>
              <th>モード</th>
              ${hasEditButton ? '<th>操作</th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${logs.map(log => {
              const logDataString = JSON.stringify(log);
              const timestamp = new Date(log.timestamp).toLocaleString('ja-JP');

              return `
                <tr class="log-row ${hasEditButton ? 'editable' : ''}" data-log='${logDataString}'>
                  <td data-label="日時">${timestamp}</td>
                  <td data-label="名前">${log.name_kanji} (${log.student_number})</td>
                  <td data-label="モード"><strong>${log.mode.toUpperCase()}</strong></td>
                  ${hasEditButton
                    ? `<td data-label="操作"><button class="btn btn-edit-inline">✏</button></td>`
                    : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;
      const prevPageButton = logListElement.querySelector('#prev-page');
      const nextPageButton = logListElement.querySelector('#next-page');
      prevPageButton.disabled = page === 0;
      nextPageButton.disabled = logs.length < 20;
      prevPageButton.addEventListener('click', () => {
        fetchAndDisplayLogs(page - 1);
      });
      nextPageButton.addEventListener('click', () => {
        fetchAndDisplayLogs(page + 1);
      });
      if (hasEditButton) {
          logListElement.querySelectorAll('.btn-edit-inline').forEach(button => {
              button.addEventListener('click', (e) => {
                const row = e.target.closest('tr');
                createInlineEditForm(row);
              });
          });
      }
  }

  function createInlineEditForm(row) {
    const existingEditForm = logListElement.querySelector('.edit-form-row');
    if (existingEditForm) {
      cancelInlineEdit(existingEditForm);
    }

    const logDataString = row.getAttribute('data-log');
    const log = JSON.parse(logDataString);

    const timezoneOffset = new Date(log.timestamp).getTimezoneOffset() * 60000; // ms
    const localISOTime = new Date(new Date(log.timestamp) - timezoneOffset).toISOString().slice(0, 16);

    const originalHtml = row.innerHTML;

    row.classList.add('edit-form-row');
    row.innerHTML = `
      <td data-label="日時">
        <input
          type="datetime-local"
          id="edit-timestamp-select-${log.id}"
          class="inline-edit-input"
          value="${localISOTime}">
      </td>
      <td data-label="名前">${log.name_kanji} (${log.student_number})</td>
      <td data-label="モード">
        <select id="edit-mode-select-${log.id}" class="inline-edit-select">
          <option value="in" ${log.mode === 'in' ? 'selected' : ''}>IN</option>
          <option value="out" ${log.mode === 'out' ? 'selected' : ''}>OUT</option>
          <option value="rest" ${log.mode === 'rest' ? 'selected' : ''}>REST</option>
        </select>
      </td>
      <td data-label="操作">
        <button class="btn btn-save">保存</button>
        <button class="btn btn-cancel">ｷｬﾝｾﾙ</button>
      </td>
    `;

    row['originalHtml'] = originalHtml;

    row.querySelector('.btn-save').addEventListener('click', async () => {
        const newMode = row.querySelector(`#edit-mode-select-${log.id}`).value;
        const newTimestampValue = row.querySelector(`#edit-timestamp-select-${log.id}`).value;
        const newTimestamp = new Date(newTimestampValue).toISOString();

        const originalDate = new Date(log.timestamp);
        originalDate.setSeconds(0, 0);
        const originalTimestampTruncated = originalDate.toISOString();
        if (newMode === log.mode && newTimestamp === originalTimestampTruncated) {
            toggleModal('モードも日時も変更されていません。', 3);
            return;
        }

        try {
            row.querySelector('td[data-label="操作"]').innerHTML = '<span>保存中...</span>';

            const result = await window.electronAPI.editLog({
                logId: log.id,
                newMode: newMode,
                newTimestamp: newTimestamp
            });

            if (result !== false) {
                response = await window.electronAPI.fetchLogs(getPageFromURL());
                renderLogList(response.logs, response.studentName, false, getPageFromURL());
            }
        } catch (err) {
            console.error('Error editing log:', err);
            toggleModal(`編集に失敗しました: ${err.message}`, 5);
            cancelInlineEdit(row);
        }
    });

    row.querySelector('.btn-cancel').addEventListener('click', () => {
        cancelInlineEdit(row);
    });
  }

  function cancelInlineEdit(row) {
    if (row && row['originalHtml']) {
        row.innerHTML = row['originalHtml'];
        row.classList.remove('edit-form-row');
        row.removeAttribute('originalHtml');
        const editButton = row.querySelector('.btn-edit-inline');
        if (editButton) {
          editButton.addEventListener('click', (e) => {
            createInlineEditForm(e.target.closest('tr'));
          });
        }
    }
  }


  // (ログタブ用) カードタッチでユーザー別ログが main から送られてきたときのリスナー
  window.electronAPI.onLogResult((event, success, response) => {
      const existingEditForm = logListElement.querySelector('.edit-form-row');
      if (existingEditForm) {
        cancelInlineEdit(existingEditForm);
      }
      if (success) {
          toggleModal(`${response.logs[0]?.name_kanji || 'ユーザー'}さんのログを表示します`, 3);
          renderLogList(response.logs, `${response.logs[0]?.name_kanji || '不明'}さんのログ`, true, 0);
      } else {
          toggleModal(`エラー: ${response.message} (${response.user || '不明なカード'})`, 5);
      }
  });

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

    if (modalInterval) {
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

  function setPageToURL(page) {
    window.history.pushState(null, '', `?page=${page}`);
  }

  function getPageFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('page') ? parseInt(params.get('page')) : 0;
  }

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