/*
 * ═══════════════════════════════════════════════════════════════
 *  THU DỮ LIỆU HIỆU CHUẨN GYRO (Paper: Wang et al. 2024 — xoay 360°)
 *  Xuất đúng cột template:  time_s  stage  gx_dps  gy_dps  gz_dps
 *  In dạng TAB → dán thẳng vào sheet "Data" của gyro_template.xlsx (từ ô A2).
 * ═══════════════════════════════════════════════════════════════
 *
 * Lệnh qua Serial Monitor (115200 baud, gửi 1 ký tự):
 *   s : bắt đầu / tiếp tục stream (đặt lại mốc time = 0 nếu đang dừng)
 *   x : dừng stream
 *   0 : stage = 0  (ĐỨNG YÊN — giữ 3-5 giây để ước lượng bias)
 *   1 : stage = 1  (đang XOAY 360° quanh trục X)
 *   2 : stage = 2  (đang XOAY 360° quanh trục Y)
 *   3 : stage = 3  (đang XOAY 360° quanh trục Z)
 *   h : in lại hướng dẫn
 *
 * QUY TRÌNH: s → (giữ yên, stage 0) → bấm 1, xoay X 360° → bấm 0 nghỉ →
 *            bấm 2, xoay Y 360° → bấm 0 nghỉ → bấm 3, xoay Z 360° → x.
 */

#include <Wire.h>

// ── Chân I2C (ESP32-C3 của dự án: 8/9; ESP32 thường: 21/22) ──
#define MPU_SDA_PIN 8
#define MPU_SCL_PIN 9
#define MPU_ADDR    0x68

const float    GYRO_LSB_PER_DPS = 131.0f;   // ±250 °/s (GYRO_CONFIG = 0x00)
const int      FS_HZ            = 100;       // tần số lấy mẫu
const uint32_t PERIOD_US        = 1000000UL / FS_HZ;

int      stage     = 0;
bool     streaming = false;
uint32_t t0Ms      = 0;
uint32_t nextUs    = 0;

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

void initMPU() {
  Wire.begin(MPU_SDA_PIN, MPU_SCL_PIN);
  Wire.setClock(400000);
  delay(10);
  mpuWrite(0x6B, 0x00);  // wake
  delay(5);
  mpuWrite(0x1B, 0x00);  // GYRO_CONFIG : ±250 °/s
  mpuWrite(0x1C, 0x00);  // ACCEL_CONFIG: ±2 g
  mpuWrite(0x1A, 0x03);  // CONFIG      : DLPF 44 Hz
  mpuWrite(0x19, 0x09);  // SMPLRT_DIV  : 1k/(1+9)=100 Hz
}

void readGyroDps(float &gx, float &gy, float &gz) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x43);                 // GYRO_XOUT_H
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6);
  int16_t rx = (Wire.read() << 8) | Wire.read();
  int16_t ry = (Wire.read() << 8) | Wire.read();
  int16_t rz = (Wire.read() << 8) | Wire.read();
  gx = rx / GYRO_LSB_PER_DPS;
  gy = ry / GYRO_LSB_PER_DPS;
  gz = rz / GYRO_LSB_PER_DPS;
}

void printHelp() {
  Serial.println(F("# GYRO COLLECT — lenh: s=start x=stop 0/1/2/3=stage h=help"));
  Serial.println(F("# Quy trinh: s, giu yen(0), bam 1 xoay X 360, 0 nghi, 2 xoay Y, 0, 3 xoay Z, x"));
  Serial.println(F("# Dan tu dong A2 cua sheet Data (TAB-separated)."));
  Serial.println(F("time_s\tstage\tgx_dps\tgy_dps\tgz_dps"));
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    switch (c) {
      case 's':
        if (!streaming) { t0Ms = millis(); nextUs = micros(); }
        streaming = true;
        Serial.println(F("# >> streaming ON"));
        break;
      case 'x':
        streaming = false;
        Serial.println(F("# >> streaming OFF"));
        break;
      case '0': case '1': case '2': case '3':
        stage = c - '0';
        Serial.print(F("# >> stage = ")); Serial.println(stage);
        break;
      case 'h':
        printHelp();
        break;
      default: break;  // bỏ qua \r \n và ký tự khác
    }
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  initMPU();
  printHelp();
}

void loop() {
  handleSerial();
  if (!streaming) return;

  uint32_t now = micros();
  if ((int32_t)(now - nextUs) >= 0) {
    nextUs += PERIOD_US;
    float gx, gy, gz;
    readGyroDps(gx, gy, gz);
    float t = (millis() - t0Ms) / 1000.0f;
    Serial.print(t, 3);   Serial.print('\t');
    Serial.print(stage);  Serial.print('\t');
    Serial.print(gx, 4);  Serial.print('\t');
    Serial.print(gy, 4);  Serial.print('\t');
    Serial.println(gz, 4);
  }
}
