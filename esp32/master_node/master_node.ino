/*
 * ═══════════════════════════════════════════════════════════════
 *  ArmTrack MASTER — ESP32 (Bản Tối Ưu Hóa Tuyệt Đối)
 *  Cập nhật:
 *  - Gói BLE chuẩn 80 bytes (xóa frame_seq)
 *  - Chống treo CPU với delay(1)
 *  - Kiểm tra BLE Client Subscribe trước khi Notify
 * ═══════════════════════════════════════════════════════════════
 */

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>

#define NUM_NODES 6
#define TARGET_FPS 50
#define FRAME_INTERVAL_MS (1000 / TARGET_FPS) // 20ms
#define SYNC_INTERVAL_MS 1000                 // Trả về 1000ms (1s) để không gây nghẽn sóng BLE

// CẤU HÌNH CHÂN LED
#define MLED_R 15
#define MLED_G 2
#define MLED_B 4

void setLED(uint8_t r, uint8_t g, uint8_t b) {
  analogWrite(MLED_R, r);
  analogWrite(MLED_G, g);
  analogWrite(MLED_B, b);
}

// UUID & STRUCT
#define NUS_SERVICE_UUID "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define NUS_TX_CHAR_UUID "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

#pragma pack(push, 1)
typedef struct {
  uint8_t node_id;
  uint32_t timestamp;
  int16_t ax, ay, az, gx, gy, gz;
  uint8_t seq;
} NodePacket_t;
typedef struct {
  uint8_t type;
  uint32_t master_time;
} SyncPacket_t;

// [FIX 1]: Loại bỏ frame_seq để gói tin về đúng 80 bytes
typedef struct {
  uint8_t header;             // 1 byte (0xAA)
  uint8_t active_mask;        // 1 byte
  uint32_t timestamp;         // 4 bytes
  int16_t data[NUM_NODES][6]; // 72 bytes
  uint8_t checksum;           // 1 byte
  uint8_t footer;             // 1 byte (0x55)
} BLEFrame_t;                 // TỔNG: 80 bytes
#pragma pack(pop)

static volatile int16_t write_buf[NUM_NODES][6];
static volatile uint8_t write_mask = 0;   // node nào đã gửi trong chu kỳ hiện tại
static volatile uint8_t seen_mask = 0;    // node nào ĐÃ TỪNG xuất hiện (để biết "đủ" 1 chu kỳ)
static portMUX_TYPE buf_mux = portMUX_INITIALIZER_UNLOCKED;

static BLECharacteristic *pTxChar = nullptr;
static BLE2902 *pDescr =
    nullptr; // [FIX 3]: Con trỏ lưu descriptor để check subscribe
static volatile bool bleConnected = false;
static uint8_t broadcast_mac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

// ── P1: xin connection interval NGẮN sau khi kết nối (mượt + cho phép >50Hz) ──
static volatile bool connParamsPending = false;
static uint32_t connReqAtMs = 0;            // mốc thời gian sẽ gửi yêu cầu (hoãn sau connect)
static esp_bd_addr_t connPeerAddr;
static BLEServer *gServer = nullptr;

// BLE CALLBACKS
class MasterServerCB : public BLEServerCallbacks {
  void onConnect(BLEServer *s, esp_ble_gatts_cb_param_t *param) override {
    bleConnected = true;
    setLED(0, 255, 0); // 🟢 KẾT NỐI: Đổi sang Xanh Lá

    // P1: KHÔNG xin interval ngay (làm Windows/Chrome scan service lỗi). Lưu peer
    // lại, hoãn ~1.5s rồi mới xin trong loop() để vừa ổn định vừa nhanh.
    gServer = s;
    memcpy(connPeerAddr, param->connect.remote_bda, sizeof(esp_bd_addr_t));
    connReqAtMs = millis() + 1500;
    connParamsPending = true;
  }
  void onDisconnect(BLEServer *s) override {
    bleConnected = false;
    connParamsPending = false;
    setLED(0, 0, 255); // 🔵 MẤT KẾT NỐI: Đổi về Xanh Dương
    BLEDevice::startAdvertising();
  }
};

static void IRAM_ATTR onNodeData(const esp_now_recv_info_t *info,
                                 const uint8_t *data, int len) {
  if (len != sizeof(NodePacket_t))
    return;
  const NodePacket_t *pkt = (const NodePacket_t *)data;
  uint8_t idx = pkt->node_id - 1;
  if (idx >= NUM_NODES)
    return;

  portENTER_CRITICAL_ISR(&buf_mux);
  write_buf[idx][0] = pkt->ax;
  write_buf[idx][1] = pkt->ay;
  write_buf[idx][2] = pkt->az;
  write_buf[idx][3] = pkt->gx;
  write_buf[idx][4] = pkt->gy;
  write_buf[idx][5] = pkt->gz;
  write_mask |= (1 << idx);
  seen_mask |= (1 << idx);
  portEXIT_CRITICAL_ISR(&buf_mux);
}

void setup() {
  Serial.begin(115200);
  pinMode(MLED_R, OUTPUT);
  pinMode(MLED_G, OUTPUT);
  pinMode(MLED_B, OUTPUT);

  setLED(0, 0, 255); // 🔵 CHỜ ĐỢI: Xanh Dương khi khởi động

  WiFi.mode(WIFI_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);
  // Đã xóa esp_wifi_set_max_tx_power(78) vì ép công suất phát liên tục sẽ gây sụt nguồn (Brownout Reset)
  WiFi.disconnect();
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE); // P2: KHOÁ kênh 1 (master & 6 node phải trùng) — tránh trôi kênh gây mất gói

  esp_now_init();
  esp_now_register_recv_cb(onNodeData);

  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, broadcast_mac, 6);
  peer.channel = 1;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  BLEDevice::init("ESP32_ArmTrack");
  BLEDevice::setMTU(200);
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MasterServerCB());
  BLEService *pService = pServer->createService(NUS_SERVICE_UUID);
  pTxChar = pService->createCharacteristic(NUS_TX_CHAR_UUID,
                                           BLECharacteristic::PROPERTY_NOTIFY);

  // Lưu descriptor vào biến toàn cục để check trạng thái
  pDescr = new BLE2902();
  pTxChar->addDescriptor(pDescr);
  pService->start();

  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(NUS_SERVICE_UUID);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x18);
  pAdv->start();
}

void loop() {
  uint32_t now = millis();
  static uint32_t lastSyncMs = 0;
  static uint32_t nextFrameAt = 0;

  // P1: tới hẹn (~1.5s sau connect) thì xin connection interval 7.5–15ms (latency 0,
  // supervision 4s) — đủ nhanh cho ≥50–130 notify/s, mở đường lên 100Hz.
  if (connParamsPending && (int32_t)(now - connReqAtMs) >= 0) {
    connParamsPending = false;
    if (gServer) gServer->updateConnParams(connPeerAddr, 0x06, 0x0C, 0, 400);
  }

  // Phát Sync Broadcast chống nhiễu
  if (now - lastSyncMs >= SYNC_INTERVAL_MS) {
    lastSyncMs = now;
    SyncPacket_t syncPkt = {0x01, now};
    esp_now_send(broadcast_mac, (uint8_t *)&syncPkt, sizeof(syncPkt));
  }

  // Quyết định thời điểm đẩy Frame BLE:
  //  - "complete": tất cả node TỪNG thấy đã gửi xong trong chu kỳ này
  //    → gói trọn 1 chu kỳ TDMA vào đúng 1 frame (không bị xé lẻ).
  //  - "timeout": fallback 20ms nếu có node rớt, để vẫn giữ ~50Hz.
  uint8_t wm_now, sm_now;
  portENTER_CRITICAL(&buf_mux);
  wm_now = write_mask;
  sm_now = seen_mask;
  portEXIT_CRITICAL(&buf_mux);

  bool timeout = (now >= nextFrameAt);
  bool complete = (sm_now != 0) && ((wm_now & sm_now) == sm_now);

  if (timeout || complete) {
    nextFrameAt = now + FRAME_INTERVAL_MS;

    BLEFrame_t frame;
    memset(&frame, 0, sizeof(BLEFrame_t));

    portENTER_CRITICAL(&buf_mux);
    frame.active_mask = write_mask;
    if (write_mask > 0) {
      memcpy(frame.data, (const void *)write_buf, sizeof(frame.data));
      write_mask = 0;
    }
    portEXIT_CRITICAL(&buf_mux);

    // [FIX 3]: Chỉ gửi khi đã kết nối, Client ĐÃ SUBSCRIBE và có dữ liệu
    if (bleConnected && pDescr->getNotifications() && frame.active_mask > 0) {
      frame.header = 0xAA;
      frame.timestamp = now;

      uint8_t *raw = (uint8_t *)&frame;
      uint8_t chk = 0;
      // Tính checksum cho 78 bytes đầu (Xóa frame_seq nên giảm 1 byte)
      for (int i = 0; i < 78; i++)
        chk ^= raw[i];

      frame.checksum = chk;
      frame.footer = 0x55;

      pTxChar->setValue(raw, sizeof(BLEFrame_t));
      pTxChar->notify();
    }
  }

  // [FIX 2]: Trả lại 1 mili-giây cho hệ điều hành FreeRTOS để các tác vụ ngầm
  // hoạt động Ngăn chặn hoàn toàn hiện tượng treo chip/Watchdog reset do nghẽn
  // CPU Core 1
  delay(1);
}