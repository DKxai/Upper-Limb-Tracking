/*
 * ═══════════════════════════════════════════════════════════════
 *  KIỂM CHỨNG HIỆU CHUẨN MPU6050 — đối chiếu với THƯỚC ĐO GÓC
 *  ESP32-C3 + MPU6050. Áp đúng bộ calib (giống CalibrationData.js):
 *     a_cal = M · (a_raw_ms2 − accelBias)      [m/s²]
 *     g_cal = K ⊙ (g_raw_dps + gyroBias)       [°/s]
 *
 *  In ra 2 loại GÓC để bạn so với thước:
 *   1) TILT  — góc NGHIÊNG tính từ accel (TĨNH, không trôi). In cả raw & cal
 *      để thấy calib kéo góc về đúng. → Dùng cho thước đo độ nghiêng / eke.
 *   2) GYRO_INT — góc gyro TÍCH PHÂN (đã calib), bấm 'r' để zero rồi xoay tới
 *      một góc đã biết trên thước → kiểm tra scale K. → Dùng cho thước xoay.
 *
 *  Lệnh Serial (115200): r=zero góc tích phân  z=lấy lại bias đứng yên  h=help
 * ═══════════════════════════════════════════════════════════════
 */

#include <Wire.h>
#include <math.h>

// ── Chân I2C (ESP32-C3 dự án: 8/9; ESP32 thường: 21/22) ──
#define MPU_SDA_PIN 8
#define MPU_SCL_PIN 9
#define MPU_ADDR    0x68

const float    GYRO_LSB_PER_DPS = 131.0f;     // ±250 °/s
const float    ACCEL_LSB_PER_G  = 16384.0f;   // ±2 g
const float    LOCAL_G          = 9.80665f;
const int      FS_HZ            = 100;
const uint32_t PERIOD_US        = 1000000UL / FS_HZ;
const float    DT               = 1.0f / FS_HZ;

// ════════════════════════════════════════════════════════════════
//  THAM SỐ HIỆU CHUẨN — dán bộ của node cần kiểm (mặc định: NODE 1)
//  Lấy từ js/utils/CalibrationData.js. Đổi 4 mảng dưới cho node khác.
// ════════════════════════════════════════════════════════════════
const float M[3][3] = {
  { 0.992636f, -0.000123f,  0.001343f},
  {-0.000123f,  0.994363f, -0.001070f},
  { 0.001343f, -0.001070f,  0.989107f}
};
const float accelBias[3] = { 0.432008f, -0.042612f, -1.098284f };   // m/s²
const float K[3]         = { 1.05674187f, 1.00193541f, 1.01461782f };
const float gyroBias[3]  = { 0.80316301f, -0.98965160f, 1.32338875f }; // °/s

// ── Trạng thái ──
uint32_t nextUs = 0;
float intX = 0, intY = 0, intZ = 0;        // góc gyro tích phân đã calib (°)
float compPitch = 0, compRoll = 0;          // góc bù (accel + gyro)
float gZero[3]  = {0, 0, 0};                 // bù trôi tức thời lúc khởi động (ngoài calib)
bool  haveComp  = false;

void mpuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(reg); Wire.write(val);
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

// Đọc raw -> g và °/s
void readPhys(float &axg, float &ayg, float &azg,
              float &gxd, float &gyd, float &gzd) {
  Wire.beginTransmission(MPU_ADDR);
  Wire.write(0x3B);                       // ACCEL_XOUT_H
  Wire.endTransmission(false);
  Wire.requestFrom(MPU_ADDR, 14);
  int16_t ax = (Wire.read() << 8) | Wire.read();
  int16_t ay = (Wire.read() << 8) | Wire.read();
  int16_t az = (Wire.read() << 8) | Wire.read();
  Wire.read(); Wire.read();               // bỏ nhiệt độ
  int16_t gx = (Wire.read() << 8) | Wire.read();
  int16_t gy = (Wire.read() << 8) | Wire.read();
  int16_t gz = (Wire.read() << 8) | Wire.read();
  axg = ax / ACCEL_LSB_PER_G; ayg = ay / ACCEL_LSB_PER_G; azg = az / ACCEL_LSB_PER_G;
  gxd = gx / GYRO_LSB_PER_DPS; gyd = gy / GYRO_LSB_PER_DPS; gzd = gz / GYRO_LSB_PER_DPS;
}

// a_cal = M·(a_raw_ms2 − accelBias)
void calibAccel(float axg, float ayg, float azg, float out[3]) {
  float rx = axg * LOCAL_G - accelBias[0];
  float ry = ayg * LOCAL_G - accelBias[1];
  float rz = azg * LOCAL_G - accelBias[2];
  out[0] = M[0][0]*rx + M[0][1]*ry + M[0][2]*rz;
  out[1] = M[1][0]*rx + M[1][1]*ry + M[1][2]*rz;
  out[2] = M[2][0]*rx + M[2][1]*ry + M[2][2]*rz;
}

// g_cal = K⊙(g_raw + gyroBias)
void calibGyro(float gxd, float gyd, float gzd, float out[3]) {
  out[0] = K[0] * (gxd + gyroBias[0]);
  out[1] = K[1] * (gyd + gyroBias[1]);
  out[2] = K[2] * (gzd + gyroBias[2]);
}

// Góc nghiêng (deg) từ vector gia tốc (chỉ cần hướng, không cần độ lớn)
float tiltPitch(float x, float y, float z) {           // quanh trục Y
  return atan2f(-x, sqrtf(y*y + z*z)) * 180.0f / PI;
}
float tiltRoll(float x, float y, float z) {            // quanh trục X
  return atan2f(y, z) * 180.0f / PI;
}

// Lấy lại bias đứng yên (NGOÀI calib) để góc tích phân không trôi lúc bắt đầu
void captureGyroZero() {
  Serial.println(F("# Giu YEN ~1.5s de lay bias dung yen..."));
  const int N = 150;
  double s[3] = {0, 0, 0};
  for (int i = 0; i < N; i++) {
    float axg, ayg, azg, gxd, gyd, gzd, gc[3];
    readPhys(axg, ayg, azg, gxd, gyd, gzd);
    calibGyro(gxd, gyd, gzd, gc);
    s[0] += gc[0]; s[1] += gc[1]; s[2] += gc[2];
    delay(8);
  }
  gZero[0] = s[0] / N; gZero[1] = s[1] / N; gZero[2] = s[2] / N;
  intX = intY = intZ = 0;
  haveComp = false;
  Serial.print(F("# gZero (°/s) = "));
  Serial.print(gZero[0], 3); Serial.print(' ');
  Serial.print(gZero[1], 3); Serial.print(' ');
  Serial.println(gZero[2], 3);
}

void printHelp() {
  Serial.println(F("# ── KIEM CHUNG CALIB MPU6050 (doi chieu thuoc do goc) ──"));
  Serial.println(F("# TILT  = goc nghieng tu accel (TINH, khong troi). So sanh cal vs thuoc."));
  Serial.println(F("#         raw = chua calib, cal = da calib -> cal phai sat thuoc hon."));
  Serial.println(F("# GYRO_INT = goc gyro tich phan da calib. Bam 'r' zero roi xoay toi goc tren thuoc."));
  Serial.println(F("# Lenh: r=zero goc tich phan  z=lay lai bias dung yen  h=help"));
}

void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == 'r') { intX = intY = intZ = 0; haveComp = false; Serial.println(F("# >> zero goc tich phan")); }
    else if (c == 'z') captureGyroZero();
    else if (c == 'h') printHelp();
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  initMPU();
  printHelp();
  captureGyroZero();          // lấy bias đứng yên ngay đầu (giữ board yên lúc bật nguồn)
  nextUs = micros();
}

void loop() {
  handleSerial();

  uint32_t now = micros();
  if ((int32_t)(now - nextUs) < 0) return;
  nextUs += PERIOD_US;

  float axg, ayg, azg, gxd, gyd, gzd;
  readPhys(axg, ayg, azg, gxd, gyd, gzd);

  // ── TILT từ accel: raw (chưa calib) vs cal (đã calib) ──
  float ac[3];
  calibAccel(axg, ayg, azg, ac);
  float pitchRaw = tiltPitch(axg, ayg, azg);
  float rollRaw  = tiltRoll(axg, ayg, azg);
  float pitchCal = tiltPitch(ac[0], ac[1], ac[2]);
  float rollCal  = tiltRoll(ac[0], ac[1], ac[2]);

  // ── GYRO tích phân (đã calib, trừ bias đứng yên đầu) ──
  float gc[3];
  calibGyro(gxd, gyd, gzd, gc);
  float wx = gc[0] - gZero[0], wy = gc[1] - gZero[1], wz = gc[2] - gZero[2];
  intX += wx * DT; intY += wy * DT; intZ += wz * DT;

  // ── Bộ lọc bù: gyro (ngắn hạn) + accel (dài hạn, chống trôi) ──
  if (!haveComp) { compPitch = pitchCal; compRoll = rollCal; haveComp = true; }
  compPitch = 0.98f * (compPitch + wy * DT) + 0.02f * pitchCal;  // quanh Y
  compRoll  = 0.98f * (compRoll  + wx * DT) + 0.02f * rollCal;   // quanh X

  // In ~10 Hz
  static uint8_t div = 0;
  if (++div >= (FS_HZ / 10)) {
    div = 0;
    Serial.print(F("TILT cal[P="));   Serial.print(pitchCal, 2);
    Serial.print(F(" R="));           Serial.print(rollCal, 2);
    Serial.print(F("] raw[P="));      Serial.print(pitchRaw, 2);
    Serial.print(F(" R="));           Serial.print(rollRaw, 2);
    Serial.print(F("] | GYRO_INT[X=")); Serial.print(intX, 1);
    Serial.print(F(" Y="));           Serial.print(intY, 1);
    Serial.print(F(" Z="));           Serial.print(intZ, 1);
    Serial.print(F("] | FUSE[P="));   Serial.print(compPitch, 2);
    Serial.print(F(" R="));           Serial.print(compRoll, 2);
    Serial.println(F("]"));
  }
}
