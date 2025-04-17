import nfc
import sys

service_code_univ = 0x010B  # 茨大のサービスコード
service_code_data = 0x100B  # 各データのサービスコード
system_code = 0x81F8  # システムコード

def on_connect(tag: nfc.tag.Tag) -> bool:
    print("connected")
    # print("\n".join(tag.dump()))

    idm, pmm = tag.polling(system_code=system_code)
    tag.idm, tag.pmm, tag.sys = idm, pmm, system_code

    if isinstance(tag, nfc.tag.tt3.Type3Tag):
        try:
            # 大学名学籍番号のサービス/ブロックコード指定
            sc = nfc.tag.tt3.ServiceCode(service_code_univ >> 6, service_code_univ & 0x3f)
            # 必要なブロックを指定
            block_list_univ_student_number = [
                nfc.tag.tt3.BlockCode(0, service=0),  # 大学
                nfc.tag.tt3.BlockCode(1, service=0),  # 学籍番号
            ]

            # 出力
            feli_univ_student_number = tag.read_without_encryption([sc],block_list_univ_student_number)

            # 各データ用のサービス/ブロックコード指定
            sc = nfc.tag.tt3.ServiceCode(service_code_data >> 6, service_code_data & 0x3f)
            # 必要なブロックを指定
            block_list_other_data = [
                nfc.tag.tt3.BlockCode(4, service=0),  # 漢字の名前
                nfc.tag.tt3.BlockCode(5, service=0),  # 漢字の名前続き
                nfc.tag.tt3.BlockCode(7, service=0),  # カタカナの名前
                nfc.tag.tt3.BlockCode(8, service=0),  # カタカナの名前続き
                nfc.tag.tt3.BlockCode(10, service=0), # 日付1
                nfc.tag.tt3.BlockCode(11, service=0)  # 日付2
            ]

            # 出力
            feli_other_data = tag.read_without_encryption([sc],block_list_other_data)
            
            # データを16バイトごとに分割
            block_size = 16
            blocks_univ_student_number = [feli_univ_student_number[i:i + block_size] for i in range(0, len(feli_univ_student_number), block_size)]
            blocks_other_data = [feli_other_data[i:i + block_size] for i in range(0, len(feli_other_data), block_size)]

            univ_name = blocks_univ_student_number[0].decode('shift-jis').strip().rstrip('0') # 末尾の0を削除
            student_number =  blocks_univ_student_number[1].decode('shift-jis').strip().split('01')[0]  # '01'の前まで取得

            chinese_characters_name_data = blocks_other_data[0] + blocks_other_data[1]
            chinese_characters_name = chinese_characters_name_data.decode('shift-jis').strip()

            kana_name_data = blocks_other_data[2] + blocks_other_data[3]
            kana_name = kana_name_data.decode('shift-jis').strip()

            date_data = blocks_other_data[4] + blocks_other_data[5]
            birthday = date_data[0:10].decode('ascii')  # yyyy/mm/dd
            publication_date = date_data[10:20].decode('ascii')  # yyyy/mm/dd
            expiry_date = date_data[20:30].decode('ascii')  # yyyy/mm/dd
            
            print("大学名: " + univ_name)
            print("学籍番号: " + student_number)
            print("漢字の名前: " + chinese_characters_name)
            print("カタカナの名前: " + kana_name)
            print("誕生日: " + birthday)
            print("発行日: " + publication_date)
            print("有効期限: " + expiry_date)

        except Exception as e:
            print("error: %s" % e)
    else:
        print("error: tag isn't Type3Tag")

    return True  # Trueを返しておくとタグが存在しなくなるまで待機され、離すとon_releaseが発火する


def on_release(tag: nfc.tag.Tag) -> None:
    print("released")
    sys.exit()


with nfc.ContactlessFrontend("usb") as clf:
    while True:
        clf.connect(rdwr={"on-connect": on_connect, "on-release": on_release})

