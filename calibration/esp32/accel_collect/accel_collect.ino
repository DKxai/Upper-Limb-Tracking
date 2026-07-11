/*
 * ═══════════════════════════════════════════════════════════════
 *  THU DỮ LIỆU HIỆU CHUẨN ACCEL (Paper: Hassan et al. — GNLS, ||a||=g)
 *  Mỗi tư thế tĩnh → 1 hàng:  position  ax_g  ay_g  az_g  (đơn vị g)
 *  In dạng TAB → dán thẳng vào sheet "Data" của accel_template.xlsx (từ A2).
 * ═══════════════════════════════════════════════════════════════
 *
 * Lệnh qua Serial Monitor (115200 baud):
 *   c : CAPTURE tư thế hiện tại — trung bình N mẫu khi đứng yên, in 1 hàng.
 *   r : reset bộ đếm position về 1.
 *   h : in lại hướng dẫn.
 *
 * QUY TRÌNH: đặt cảm biến TĨNH ở 1 tư thế → bấm 'c' → xoay sang tư thế khác → 'c' …
 *   Thu ≥ 12 (lý tưởng ~30) tư thế phủ đều mặt cầu:
 *   6 mặt (±X,±Y,±Z hướng lên) + các nghiêng ~45° quanh X và Y.
 *   Nếu báo "DANG DUNG YEN? thu lai" nghĩa là đang rung → giữ chặt rồi bấm 'c' lại.
 */

#include <Wire.h>

#define MPU_SDA_PIN 8
#define MPU_SCL_PIN 9
#define MPU_ADDR    0x68

const float ACCEL_LSB_PER_G = 16384.0f;  // ±2 g (ACCEL_CONFIG = 0x00)
const int   N_AVG           = 300;        // số mẫu trung bình mỗi tư thế (~vài giây)
const float STILL_STD_MAX_G = 0.02f;      // ngưỡng độ lệch chuẩn để coi là "đứng yên"

int position = 1;

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
  mpuWrite(0x19, 0x09);  // SMPLRT_DIV  : 100 Hz
}

void readAccelG(float &ax, float &ay, float &az) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                 // ACCEL_XOUT_H
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 6);
  int16_t rx = (Wire.read() << 8) | Wire.read();
  int16_t ry = (Wire.read() << 8) | Wire.read();
  int16_t rz = (Wire.read() << 8) | Wire.read();
  ax = rx / ACCEL_LSB_PER_G;
  ay = ry / ACCEL_LSB_PER_G;
  az = rz / ACCEL_LSB_PER_G;
}

void capture() {
  double sx = 0, sy = 0, sz = 0;
  double sx2 = 0, sy2 = 0, sz2 = 0;
  for (int i = 0; i < N_AVG; i++) {
    float ax, ay, az;
    readAccelG(ax, ay, az);
    sx += ax; sy += ay; sz += az;
    sx2 += (double)ax * ax; sy2 += (double)ay * ay; sz2 += (double)az * az;
    delay(5);  // ~ 200 Hz đọc, N_AVG=300 ≈ 1.5 s
  }
  float mx = sx / N_AVG, my = sy / N_AVG, mz = sz / N_AVG;
  float stdx = sqrt(max(0.0, sx2 / N_AVG - (double)mx * mx));
  float stdy = sqrt(max(0.0, sy2 / N_AVG - (double)my * my));
  float stdz = sqrt(max(0.0, sz2 / N_AVG - (double)mz * mz));

  if (stdx > STILL_STD_MAX_G || stdy > STILL_STD_MAX_G || stdz > STILL_STD_MAX_G) {
    Serial.print(F("# !! DANG RUNG (std="));
    Serial.print(stdx, 3); Serial.print(','); Serial.print(stdy, 3);
    Serial.print(','); Serial.print(stdz, 3);
    Serial.println(F(") -> giu yen roi bam 'c' lai"));
    return;
  }

  // 1 hàng dữ liệu hợp lệ (TAB)
  Serial.print(position); Serial.print('\t');
  Serial.print(mx, 5);    Serial.print('\t');
  Serial.print(my, 5);    Serial.print('\t');
  Serial.println(mz, 5);
  position++;
}

void printHelp() {
  Serial.println(F("# ACCEL COLLECT — lenh: c=capture tu the  r=reset  h=help"));
  Serial.println(F("# Dat cam bien TINH -> 'c'. Thu >=12 (~30) tu the phu deu mat cau."));
  Serial.println(F("# Dan tu dong A2 cua sheet Data (TAB-separated)."));
  Serial.println(F("position\tax_g\tay_g\taz_g"));
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    switch (c) {
      case 'c': capture(); break;
      case 'r': position = 1; Serial.println(F("# >> reset position = 1")); break;
      case 'h': printHelp(); break;
      default: break;
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
}
