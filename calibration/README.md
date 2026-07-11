# Hiệu chuẩn MPU6050 — Gyro & Accelerometer

Công cụ Python (numpy thuần, không cần scipy) hiệu chuẩn MPU6050 theo 2 bài báo:

| Cảm biến | Bài báo | Mô hình | Tham chiếu |
|---|---|---|---|
| **Gyro** | Wang et al., *In-field gyroscope autocalibration with iterative attitude estimation*, Mechatronics 2024 | `g = K ⊙ (m + b)` | Xoay tay mỗi trục đúng **360°** |
| **Accel** | Hassan et al., *A Field Calibration Method… Generalized Nonlinear Least Square* | `a = S·(ã − B)` (S đối xứng 3×3) | `‖a‖ = g` ở mọi tư thế tĩnh |

## Cài đặt
```
pip install -r requirements.txt
```

## Dùng nhanh (xem mọi thứ chạy + file mẫu có chart)
```
python mpu6050_calibration.py demo
```
Sinh ra: `gyro_template.xlsx`, `accel_template.xlsx` (kèm dữ liệu mô phỏng) và
`gyro_report.xlsx`, `accel_report.xlsx` (báo cáo có chart so sánh trước/sau).

## Quy trình thực tế

### 1) Tạo template trống để thu thập
```
python mpu6050_calibration.py gyro-template   gyro_data.xlsx
python mpu6050_calibration.py accel-template  accel_data.xlsx
```

### 2) Thu dữ liệu

**Cách A — dùng ESP32 (khuyến nghị):** nạp sketch trong [esp32/](esp32/), mở Serial
Monitor (115200), bôi đen các dòng dữ liệu rồi **dán thẳng vào sheet `Data` từ ô A2**
(output là TAB nên Excel tự tách cột).

- `esp32/gyro_collect/gyro_collect.ino` — lệnh: `s` start, `0/1/2/3` đặt stage, `x` stop.
  Quy trình: `s` → giữ yên (stage 0) → `1` xoay X 360° → `0` nghỉ → `2` xoay Y → `0` → `3` xoay Z → `x`.
- `esp32/accel_collect/accel_collect.ino` — lệnh: `c` capture (tự trung bình 300 mẫu khi
  đứng yên, in 1 hàng/tư thế), `r` reset. Báo "DANG RUNG" nghĩa là chưa đủ yên → bấm `c` lại.
- Chân I2C mặc định `SDA=8, SCL=9` (ESP32-C3 của dự án); ESP32 thường đổi sang `21/22`.
- Cấu hình MPU trùng firmware dự án: ±250°/s, ±2g, DLPF 44Hz, 100Hz.

**Cách B — tự điền:** dán dữ liệu thô vào sheet **Data** theo đúng cột bên dưới.

**GYRO** — cột `time_s, stage, gx_dps, gy_dps, gz_dps` (gyro thô **°/s** = raw/131):
- `stage = 0`: đứng yên tuyệt đối 3–5 s (ước lượng bias).
- `stage = 1/2/3`: xoay tay **một vòng 360°** quanh trục **X / Y / Z**, đều tay, một chiều.
- Giữa các lần nên dừng vài giây. Không cần thiết bị chuẩn.

**ACCEL** — cột `position, ax_g, ay_g, az_g` (accel **g** = raw/16384):
- Mỗi hàng = 1 tư thế **tĩnh** (giữ yên, ghi vài giây rồi lấy trung bình).
- Thu ≥ 12 (lý tưởng ~30) tư thế phủ đều mặt cầu: 6 mặt ±X/±Y/±Z + nghiêng ~45°.

### 3) Chạy hiệu chuẩn → báo cáo Excel có chart
```
python mpu6050_calibration.py gyro   gyro_data.xlsx
python mpu6050_calibration.py accel  accel_data.xlsx
```

### 4) Kiểm chứng Trước/Sau trên tập dữ liệu RIÊNG (held-out — khuyến nghị cho DATN)
Thu **một bộ dữ liệu thứ hai** (cùng template, tư thế / vòng xoay MỚI), rồi fit tham số
trên bộ 1 và đo sai số Trước/Sau trên bộ 2 — đây là so sánh trung thực, không "học vẹt":
```
python mpu6050_calibration.py validate-gyro   gyro_calib.xlsx  gyro_verify.xlsx
python mpu6050_calibration.py validate-accel  accel_calib.xlsx accel_verify.xlsx
```
Xuất `*_truocsau.xlsx` với chart + bảng **Thô (trước) vs Hiệu chuẩn (sau)** trên dữ liệu mới.

> ZARU (bù trôi lúc chạy): hiệu chuẩn offline ở đây cho **scale (K, S)** ổn định + **bias mốc**.
> Bias gyro trôi theo nhiệt/thời gian nên app tự bù tiếp bằng **ZARU** trong
> `js/services/SensorFusion.js` (`FUSION_CONFIG.ZARU_*` ở `js/utils/Constants.js`):
> khi cảm biến đứng yên (|ω| nhỏ, ‖a‖≈g) nó cập nhật chậm `gyroBias`.

### 5) Calib cả 6 node (6 con MPU6050) → tự ghép vào CalibrationData.js
Mỗi node là 1 ESP32-C3 + 1 MPU6050 với scale/bias RIÊNG, nên cần 6 bộ tham số.
Calib lần lượt từng con (cắm USB từng board, nạp sketch collect), đặt tên file theo node:
```
# Với MỖI node N = 1..6 (thu nodeN_gyro.xlsx + nodeN_accel.xlsx như bước 2):
python mpu6050_calibration.py node 1  node1_gyro.xlsx  node1_accel.xlsx
python mpu6050_calibration.py node 2  node2_gyro.xlsx  node2_accel.xlsx
# ... tới node 6
```
Mỗi lệnh ghi `nodeN_calib.json` + 2 báo cáo `nodeN_*_report.xlsx`. Sau khi xong (kể cả mới
vài node), gộp lại:
```
python mpu6050_calibration.py build-js .
```
→ in + ghi `CALIBRATION_nodes.js`: **nguyên khối `CALIBRATION = {1:…,6:…}`** đúng format,
node nào chưa calib tự để `DEFAULT_CALIB`. Dán đè khối `CALIBRATION` trong
`js/utils/CalibrationData.js` (giữ nguyên `DEFAULT_CALIB` ở trên cho fallback).

> Quan trọng: theo dõi **board nào sẽ chạy NODE_ID nào** — calib gắn theo từng con MPU vật lý.
> Sau khi calib xong, nạp lại `esp32/sensor_node/sensor_node.ino` với đúng `#define NODE_ID`.

### 6) Kiểm chứng bằng THƯỚC ĐO GÓC (firmware on-device)
Nạp `calibration/esp32/calib_check/calib_check.ino` (đã nhúng sẵn calib Node 1 — đổi 4 mảng
`M/accelBias/K/gyroBias` đầu file cho node khác). Mở Serial 115200, giữ board yên lúc bật để
nó lấy bias đứng yên. Nó in liên tục:
- **TILT cal[P R] raw[P R]** — góc nghiêng từ accel (TĨNH, không trôi). `raw` chưa calib,
  `cal` đã calib → đặt board lên thước, nghiêng tới góc đã biết, **`cal` phải sát thước hơn `raw`**.
- **GYRO_INT[X Y Z]** — góc gyro tích phân đã calib. Bấm `r` để zero rồi xoay tới góc trên thước
  → kiểm tra scale K (vd thước 90° thì GYRO_INT ≈ 90°).
- **FUSE[P R]** — góc bù accel+gyro để theo dõi realtime.

Lệnh: `r` zero góc tích phân · `z` lấy lại bias đứng yên · `h` trợ giúp.

## Báo cáo gồm gì
- **Gyro** (`*_report.xlsx`): tham số `K`, `bias`; mỗi trục 1 chart **góc tích phân
  Thô vs Hiệu chuẩn vs 360°**; chart cột **|sai số| trước/sau**; sheet `ChepVaoCode`.
- **Accel** (`*_report.xlsx`): ma trận `S`, bias `B` (g và m/s²); chart **‖a‖ mỗi tư thế
  Thô vs Hiệu chuẩn vs chuẩn g**; bảng **RMS/Max sai số trước–sau**; sheet `ChepVaoCode`.

## Nối vào web app
Sheet **ChepVaoCode** in sẵn dòng để dán vào `js/utils/CalibrationData.js`
(`accel.M`, `accel.bias` đơn vị m/s²; `gyro.K`, `gyro.bias` — đúng quy ước hiện tại
`g_cal = K·(g_raw + bias)`, `a_cal = M·(a_raw_ms2 − bias)`).

## Lưu ý quan trọng (về accel)
Hiệu chuẩn accel theo `‖a‖ = g` chỉ xác định **scale + lệch trục tới một phép quay**
(gauge ambiguity): đường chéo của `S` và `bias` rất ổn định, nhưng các phần tử
**ngoài đường chéo (cross-coupling) chỉ xác định được tương đối** — vì độ lớn trọng
trường bất biến dưới phép quay `S → Q·S`. Điều này **không ảnh hưởng mục tiêu** (sau
hiệu chuẩn `‖a‖ ≈ g`), nhưng nếu cần khung tuyệt đối thì phải thêm tham chiếu hướng
(vd tư thế chuẩn). Sai số `‖a‖` sau hiệu chuẩn (trong báo cáo) mới là thước đo đáng tin.

## Kiểm chứng (demo)
Trên dữ liệu mô phỏng, công cụ hồi phục đúng tham số:
- Gyro: `K=[1.05, 0.97, 1.02]`, `bias=[0.8, −0.6, 1.1]` → sai số góc 360° còn **~0.01°** (trước 11–20°).
- Accel: RMS `‖a‖` sai số **0.025 g → 0.003 g**.

Tần số lấy mẫu mặc định gyro `fs = 100 Hz` và hệ số `GYRO_LSB_PER_DPS=131`,
`ACCEL_LSB_PER_G=16384` (FS ±250°/s, ±2g) — sửa đầu file nếu bạn đổi FS_SEL/AFS_SEL.
