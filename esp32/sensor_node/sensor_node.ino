/*
 * ═══════════════════════════════════════════════════════════════
 *  ArmTrack NODE — ESP32-C3 (Bản Hoàn Chỉnh - Tối Giản LED - Chống Nhiễu)
 * ═══════════════════════════════════════════════════════════════
 */

#include <WiFi.h>
#include <Wire.h>
#include <esp_now.h>
#include <esp_wifi.h>

#define NODE_ID 1            // ĐỔI CHO TỪNG MẠCH (1-6)
#define SAMPLE_RATE_US 20000 // 20ms = 50Hz
#define SLOT_WIDTH_US 3000   // 3ms mỗi slot
#define SYNC_TIMEOUT_MS 5000 // Tăng thời gian chịu đựng mất kết nối lên 5 giây

// ĐIỀN MAC CỦA MASTER VÀO ĐÂY
uint8_t masterMAC[] = {0x94, 0x51, 0xDC, 0x32, 0xC8, 0x1C};

// CẤU HÌNH CHÂN LED
#define LED_R_PIN 4
#define LED_G_PIN 3
#define LED_B_PIN 5

void setLED(uint8_t r, uint8_t g, uint8_t b) {
  analogWrite(LED_R_PIN, r);
  analogWrite(LED_G_PIN, g);
  analogWrite(LED_B_PIN, b);
}

// I2C & STRUCTS
#define MPU_ADDR 0x68
#define MPU_SDA_PIN 8
#define MPU_SCL_PIN 9

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
#pragma pack(pop)

volatile uint32_t lastSyncMicros = 0;
volatile uint32_t lastSyncMillis = 0;
volatile int32_t timeOffsetMs = 0;
volatile bool synced = false;
bool mpu_error = false;

bool initMPU() {
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  Wire.setClock(400000);
  Wire.setTimeOut(3);  // kẹp 3ms: MPU lỗi/nhiễu I2C không treo node cả khe TDMA
  delay(10);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x6B);
  Wire.write(0x00);
  if (Wire.endTransmission() != 0)
    return false;
  delay(5);
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1B);
  Wire.write(0x00);  // GYRO_CONFIG: ±250°/s (131 LSB/°/s)
  Wire.endTransmission();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1C);
  Wire.write(0x00);  // ACCEL_CONFIG: ±2g (16384 LSB/g)
  Wire.endTransmission();
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x1A);
  Wire.write(0x03);  // CONFIG: DLPF 44Hz
  Wire.endTransmission();
  // SMPLRT_DIV: 1kHz/(1+9) = 100Hz
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x19);
  Wire.write(0x09);
  Wire.endTransmission();
  return true;
}

void onDataRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  if (len == sizeof(SyncPacket_t) && data[0] == 0x01) {
    SyncPacket_t *sync = (SyncPacket_t *)data;
    timeOffsetMs = sync->master_time - millis();
    lastSyncMicros = micros();
    lastSyncMillis = millis();

    if (!synced && !mpu_error) {
      setLED(0, 255, 0); // 🟢 CÓ ĐỒNG BỘ: Đổi sang Xanh Lá
    }
    synced = true;
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_R_PIN, OUTPUT);
  pinMode(LED_G_PIN, OUTPUT);
  pinMode(LED_B_PIN, OUTPUT);

  WiFi.mode(WIFI_STA);
  esp_wifi_set_ps(WIFI_PS_NONE);
  esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);  // P2: KHOÁ kênh 1 (trùng master) — tránh trôi kênh gây mất gói
  // Bỏ lệnh esp_wifi_set_max_tx_power(78) vì nó gây sụt áp làm mạch reset liên tục

  esp_now_init();
  esp_now_register_recv_cb(onDataRecv);
  // KHÔNG đăng ký send-cb và KHÔNG in trong loop: USB-CDC/Serial khi đầy buffer sẽ
  // BLOCK vài ms → node trễ khe TDMA → va chạm/mất gói ("chập chờn"). Giữ loop sạch.

  // MAC chỉ in MỘT LẦN lúc khởi động (trước vòng lặp nóng) — không ảnh hưởng timing.
  Serial.print(F("[NODE] my MAC   = ")); Serial.println(WiFi.macAddress());
  Serial.printf("[NODE] masterMAC = %02X:%02X:%02X:%02X:%02X:%02X (NODE_ID=%d)\n",
                masterMAC[0], masterMAC[1], masterMAC[2],
                masterMAC[3], masterMAC[4], masterMAC[5], NODE_ID);
  Serial.flush();   // xả hết buffer khởi động TRƯỚC khi vào loop (tránh block về sau)

  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, masterMAC, 6);
  peer.channel = 1;
  peer.encrypt = false;
  esp_now_add_peer(&peer);

  if (initMPU()) {
    setLED(0, 0, 255); // 🔵 CHỜ ĐỢI: MPU tốt, Xanh Dương chờ Sync
  } else {
    mpu_error = true;
    setLED(255, 0, 0); // 🔴 LỖI: Đỏ tĩnh báo lỗi dây MPU
  }
}

void loop() {
  // KHÔNG in trong loop nóng (mỗi lần Serial đầy buffer block vài ms → lệch khe
  // TDMA → mất gói). Trạng thái đã thể hiện qua LED (đỏ=lỗi MPU, lam=chờ sync,
  // lục=đang chạy). Cần soi số liệu thì bật lại tạm thời, tắt khi đo thật.

  if (mpu_error)
    return;

  // Kiểm tra mất kết nối Sync
  if (synced && (millis() - lastSyncMillis > SYNC_TIMEOUT_MS)) {
    synced = false;
    setLED(0, 0, 255); // 🔵 MẤT SYNC: Đổi về Xanh dương
  }

  if (!synced)
    return;

  // ── Định vị trong chu kỳ TDMA (tham chiếu chung từ Sync broadcast) ──
  uint32_t elapsedUs = micros() - lastSyncMicros;
  uint32_t cycleId   = elapsedUs / SAMPLE_RATE_US;   // số thứ tự chu kỳ
  uint32_t cyclePos  = elapsedUs % SAMPLE_RATE_US;   // vị trí trong chu kỳ (0..20ms)
  uint32_t slotStart = (NODE_ID - 1) * SLOT_WIDTH_US; // khe phát của node này

  static uint32_t lastSampledCycle = 0xFFFFFFFF;
  static uint32_t lastSentCycle    = 0xFFFFFFFF;
  static NodePacket_t pkt;          // mẫu đã đọc, chờ phát trong khe TDMA
  static bool sampleReady = false;
  static uint8_t seqNum = 0;

  // ─────────────────────────────────────────────────────────────
  // BƯỚC 1 — LẤY MẪU ĐỒNG THỜI: tất cả node đọc MPU ở ĐẦU chu kỳ
  // (cyclePos ≈ 0). Vì mọi node dùng chung mốc Sync nên 6 cảm biến
  // được đọc gần như cùng một thời điểm → khử lệch thời gian giữa
  // các segment khi tính góc khớp.
  // ─────────────────────────────────────────────────────────────
  if (cycleId != lastSampledCycle) {
    lastSampledCycle = cycleId;

    pkt.node_id   = NODE_ID;
    pkt.timestamp = millis() + timeOffsetMs; // mốc thời gian = đầu chu kỳ
    pkt.seq       = seqNum++;

    Wire.beginTransmission(MPU_ADDR);
    Wire.write(0x3B);
    Wire.endTransmission(false);
    Wire.requestFrom(MPU_ADDR, 14);

    pkt.ax = (Wire.read() << 8) | Wire.read();
    pkt.ay = (Wire.read() << 8) | Wire.read();
    pkt.az = (Wire.read() << 8) | Wire.read();
    Wire.read(); // bỏ qua nhiệt độ
    Wire.read();
    pkt.gx = (Wire.read() << 8) | Wire.read();
    pkt.gy = (Wire.read() << 8) | Wire.read();
    pkt.gz = (Wire.read() << 8) | Wire.read();

    sampleReady = true;
  }

  // ─────────────────────────────────────────────────────────────
  // BƯỚC 2 — PHÁT TRONG KHE TDMA RIÊNG (so le, chống collision).
  // Dùng cycleId (KHÔNG dùng "cyclePos < slotStart") để mỗi chu kỳ
  // phát đúng một lần — sửa lỗi Node 1 (slotStart=0) chỉ phát 1 gói.
  // ─────────────────────────────────────────────────────────────
  if (sampleReady && cyclePos >= slotStart && cycleId != lastSentCycle) {
    lastSentCycle = cycleId;
    sampleReady = false;
    // ESP-NOW unicast tự retransmit ở tầng MAC nếu va chạm/lỗi nhẹ
    esp_now_send(masterMAC, (uint8_t *)&pkt, sizeof(pkt));
  }
}