import nfc
import socket
import json
import time

# サーバーのホストとポート
TCP_HOST = "127.0.0.1"  # ローカルホスト
TCP_PORT = 65432        # メインプロセスで使用しているポート

service_code_univ = 0x010B  # 茨大のサービスコード
service_code_data = 0x100B  # 各データのサービスコード
system_code = 0x81F8        # システムコード

sock = None  # グローバルなソケット

def connect_to_tcp_server():
    """TCPサーバーに接続を試みる"""
    global sock
    while sock is None:
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.connect((TCP_HOST, TCP_PORT))
            print("Connected to TCP server")
        except Exception as e:
            print("Failed to connect to TCP server:", e)
            sock = None
            print("Retrying in 5 seconds...")
            time.sleep(5)

def send_to_tcp_server(data):
    """TCPサーバーにデータを送信"""
    global sock
    try:
        if sock is None:
            connect_to_tcp_server()
        sock.sendall(json.dumps(data).encode("utf-8"))
    except Exception as e:
        print("Error sending data to TCP server:", e)
        sock = None  # エラー時にソケットをリセット
        connect_to_tcp_server()  # 再接続を試みる

def on_connect(tag: nfc.tag.Tag) -> bool:
    """NFCタグが接続されたときの処理"""

    if isinstance(tag, nfc.tag.tt3.Type3Tag):
        try:
            # 大学名学籍番号のサービス/ブロックコード指定
            sc = nfc.tag.tt3.ServiceCode(service_code_univ >> 6, service_code_univ & 0x3f)
            block_list_univ_student_number = [
                nfc.tag.tt3.BlockCode(0, service=0),  # 大学
                nfc.tag.tt3.BlockCode(1, service=0),  # 学籍番号
            ]

            # 出力
            feli_univ_student_number = tag.read_without_encryption([sc], block_list_univ_student_number)

            # 各データ用のサービス/ブロックコード指定
            sc = nfc.tag.tt3.ServiceCode(service_code_data >> 6, service_code_data & 0x3f)
            block_list_other_data = [
                nfc.tag.tt3.BlockCode(4, service=0),  # 漢字の名前
                nfc.tag.tt3.BlockCode(5, service=0),  # 漢字の名前続き
                nfc.tag.tt3.BlockCode(7, service=0),  # カタカナの名前
                nfc.tag.tt3.BlockCode(8, service=0),  # カタカナの名前続き
                nfc.tag.tt3.BlockCode(10, service=0), # 日付1
                nfc.tag.tt3.BlockCode(11, service=0)  # 日付2
            ]

            # 出力
            feli_other_data = tag.read_without_encryption([sc], block_list_other_data)

            # データを16バイトごとに分割
            block_size = 16
            blocks_univ_student_number = [feli_univ_student_number[i:i + block_size] for i in range(0, len(feli_univ_student_number), block_size)]
            blocks_other_data = [feli_other_data[i:i + block_size] for i in range(0, len(feli_other_data), block_size)]

            # データの解析
            univ_name = blocks_univ_student_number[0].decode('shift-jis').strip().rstrip('0')  # 末尾の0を削除
            student_number = blocks_univ_student_number[1].decode('shift-jis').strip().split('01')[0]  # '01'の前まで取得

            chinese_characters_name_data = blocks_other_data[0] + blocks_other_data[1]
            chinese_characters_name = chinese_characters_name_data.decode('shift-jis').strip()

            kana_name_data = blocks_other_data[2] + blocks_other_data[3]
            kana_name = kana_name_data.decode('shift-jis').strip()

            date_data = blocks_other_data[4] + blocks_other_data[5]
            birthday = date_data[0:10].decode('ascii')  # yyyy/mm/dd
            publication_date = date_data[10:20].decode('ascii')  # yyyy/mm/dd
            expiry_date = date_data[20:30].decode('ascii')  # yyyy/mm/dd

            # データを辞書形式にまとめる
            data = {
                "type": "card",
                "student_number": student_number,
                "name_kanji": chinese_characters_name,
                "name_kana": kana_name,
                "birthday": birthday,
                "publication_date": publication_date,
                "expiry_date": expiry_date
            }

            # TCPサーバーに送信
            send_to_tcp_server(data)

        except Exception as e:
            send_to_tcp_server({
                "type": "error",
                "message": "Failed to read NFC tag data",
            })
    else:
        send_to_tcp_server({
            "type": "error",
            "message": "UNSUPPORTED TAG TYPE",
        })

    return True  # タグが存在しなくなるまで待機

def on_release(tag: nfc.tag.Tag) -> None:
    """NFCタグが離されたときの処理"""
    send_to_tcp_server({"type": "released"})  # タグが離れたときに空のデータを送信

# メイン処理
connect_to_tcp_server()  # 起動時にTCPサーバーに接続
try:
    with nfc.ContactlessFrontend("usb") as clf:
        send_to_tcp_server({
            "type": "info",
            "message": "NFC READER CONNECTED"
        })
        while True:
            try:
                clf.connect(rdwr={"on-connect": on_connect, "on-release": on_release})
            except Exception as e:
                print("Error connecting to NFC reader:", e)
                send_to_tcp_server({
                    "type": "error",
                    "message": "NFC READER NOT FOUND",
                })
                time.sleep(5)  # 再接続までの待機時間
except Exception as e:
   print("Failed to initialize NFC reader:", e)
   print("!!!!!Maybe Needs zadig driver installation?!!!!!")