# PROJECT_MEMORY.md — Arm Motion Tracking Dashboard

---

# 1. Project Overview

| Field | Value |
|-------|-------|
| **Project Name** | Arm Motion Tracking Dashboard (ArmTrack) |
| **Purpose** | Hệ thống theo dõi chuyển động chi trên (Upper Limb) real-time sử dụng cảm biến IMU, phục vụ phục hồi chức năng (Rehabilitation) |
| **Problem Statement** | Bệnh nhân phục hồi chức năng cần được theo dõi góc khớp chính xác trong khi tập luyện. Giải pháp hiện tại dùng camera (Kinect, MediaPipe) bị ảnh hưởng bởi occlusion và lighting. Dự án dùng IMU sensors gắn trực tiếp lên tay để đạt độ chính xác cao hơn. |
| **Input Data** | 6× MPU6050 IMU sensors (3-axis accelerometer ±2g, 3-axis gyroscope ±250°/s), gửi qua ESP-NOW → BLE/USB |
| **Output Data** | Roll/Pitch/Yaw mỗi segment, góc khớp (shoulder flexion/abduction, elbow flexion, wrist flexion/deviation), 3D visualization, exercise feedback |
| **Target Platform** | Web browser (Chrome/Edge), ESP32 firmware |
| **Main Technologies** | Vanilla JS (ES Modules), Three.js, Chart.js, Web Bluetooth API, Web Serial API, ESP-NOW, BLE (Nordic UART), Node.js + TimescaleDB backend |

---

# 2. Research Goal

**Bài toán:** Theo dõi chuyển động chi trên hai tay (dual-arm) real-time bằng mạng lưới 6 cảm biến IMU không dây, phục vụ đánh giá và hướng dẫn bài tập phục hồi chức năng.

**Ý nghĩa thực tế:**
- Thay thế hệ thống camera-based (chịu occlusion, đắt tiền)
- Cho phép bệnh nhân tập phục hồi tại nhà với feedback real-time
- Bác sĩ có thể xem lại lịch sử phiên tập (via TimescaleDB)

**Use Cases:**
- Theo dõi Range of Motion (ROM) sau phẫu thuật vai/khuỷu
- Hướng dẫn bài tập phục hồi chức năng với guide model 3D
- Phân tích lâm sàng: so sánh ROM bệnh nhân với giá trị chuẩn
- Phân tích chất lượng chuyển động (SPARC smoothness metric)

**Hạn chế hiện tại:**
- Madgwick filter bị yaw drift (không có magnetometer)
- Chưa hỗ trợ per-node calibration riêng biệt (đang dùng 1 bộ default cho cả 6 nodes)
- 3D model chưa nối liền segments thành kinematic chain thực tế (segments rời rạc)
- Chưa có persistent storage cho calibration data

---

# 3. System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    SENSOR LAYER (Hardware)                        │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Node 1   │  │ Node 2   │  │ Node 3   │  (ESP32-C3 + MPU6050)│
│  │ L-Upper  │  │ L-Fore   │  │ L-Wrist  │  ↕ I2C 400kHz       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                      │
│       │ ESP-NOW      │              │                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                      │
│  │ Node 4   │  │ Node 5   │  │ Node 6   │                      │
│  │ R-Upper  │  │ R-Fore   │  │ R-Wrist  │                      │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                      │
│       └──────────────┴──────────────┘                            │
│                      │ ESP-NOW (broadcast)                       │
│              ┌───────┴───────┐                                   │
│              │  MASTER ESP32  │  ← Collects 6 nodes, packs      │
│              │ (ESP32_ArmTrack)│    80-byte BLE frame            │
│              └───────┬───────┘                                   │
│                      │ BLE (Nordic UART) or USB Serial           │
└──────────────────────┼───────────────────────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────────────────────┐
│              WEB DASHBOARD (Frontend)                             │
│                      ↓                                           │
│  ┌─────────────────────────┐                                     │
│  │   BluetoothService      │ ← Web Bluetooth / Web Serial API   │
│  │   (BLE binary / USB)    │                                     │
│  └──────────┬──────────────┘                                     │
│             │ RAW_DATA_RECEIVED (EventBus)                       │
│             ↓                                                    │
│  ┌─────────────────────────┐                                     │
│  │ DataProcessingViewModel  │                                    │
│  │  ├─ DataParser           │ ← JSON / CSV / Binary auto-detect │
│  │  ├─ Low-Pass Filter (IIR)│                                   │
│  │  ├─ SensorFusion         │ ← Madgwick 6DOF → Quaternion      │
│  │  │   └─ CalibrationData  │   → Euler Angles                  │
│  │  └─ SessionData          │ ← Ring buffer (500 samples)       │
│  └──────────┬──────────────┘                                     │
│             │ PROCESSED_DATA_READY (EventBus)                    │
│             ↓                                                    │
│  ┌─────────────┬──────────────┬─────────────┐                   │
│  │ ChartView   │  Arm3DView   │ Exercise    │                   │
│  │ (Chart.js)  │  (Three.js)  │ Guidance    │                   │
│  └─────────────┴──────────────┴─────────────┘                   │
│                      │                                           │
│              ┌───────┴───────┐                                   │
│              │ WebSocketClient│ → ws://localhost:8080            │
│              └───────┬───────┘                                   │
└──────────────────────┼───────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────────────┐
│              BACKEND (Node.js + TimescaleDB)                     │
│  server.js ← Express + WebSocket                                │
│  ├─ POST frames to TimescaleDB                                  │
│  ├─ GET /api/sessions (list)                                    │
│  └─ GET /api/sessions/:id (detail)                              │
└──────────────────────────────────────────────────────────────────┘
```

---

# 4. Repository Structure

```
Chart Dartboard/
├── index.html                 # Single-page entry point
├── assets/                    # 3D models (e.g., human.glb)
├── css/
│   ├── index.css              # Base styles, variables, layout
│   ├── components.css         # Sidebar, header, buttons, widgets
│   ├── charts.css             # Chart containers, grid layouts
│   └── arm3d-styles.css       # 3D tracking + exercise guidance styles
├── js/
│   ├── app.js                 # Bootstrap — wires MVVM components
│   ├── utils/
│   │   ├── Constants.js       # All configs, enums, event names
│   │   ├── EventBus.js        # Pub/Sub singleton
│   │   ├── MathUtils.js       # Math helpers (stdDev, rms, derivative)
│   │   └── CalibrationData.js # Per-node IMU calibration matrices
│   ├── models/
│   │   ├── SensorData.js      # IMUReading, Orientation, JointAngles, SensorDataSample
│   │   └── SessionData.js     # Ring buffer, ROM tracking, statistics, CSV/JSON export
│   ├── services/
│   │   ├── BluetoothService.js # BLE + USB Serial connectivity
│   │   ├── DataParser.js       # Auto-detect JSON/CSV/SSV/Binary formats
│   │   ├── SensorFusion.js     # Madgwick pipeline + joint angle computation
│   │   ├── MadgwickFilter.js   # Madgwick 6DOF AHRS (quaternion)
│   │   ├── SignalProcessing.js  # FFT, SPARC, low/high-pass, median filter
│   │   ├── ExportService.js     # CSV/JSON file download
│   │   └── WebSocketClient.js   # Sends frames to backend
│   ├── viewmodels/
│   │   ├── ConnectionViewModel.js  # BLE/USB/Demo mode management
│   │   ├── DataProcessingVM.js     # Full data pipeline orchestrator
│   │   ├── ChartViewModel.js       # Chart data preparation + throttling
│   │   └── DashboardViewModel.js   # Page navigation, recording, calibration
│   └── views/
│       ├── DashboardView.js     # Main UI renderer (all pages)
│       ├── ChartView.js         # Chart.js wrapper
│       ├── HistoryView.js       # Session history from backend
│       ├── Arm3DView.js         # Three.js 3D arm model (cylinder fallback)
│       ├── Arm3DViewHumanoid.js # Three.js 3D humanoid model (GLB/Mixamo)
│       ├── ExerciseGuidance.js  # Rehab exercise library + feedback
│       └── ExerciseAnimator.js  # Animation helper for 3D exercise guidance
├── esp32/
│   ├── master_node/master_node.ino  # Master ESP32 firmware
│   └── sensor_node/sensor_node.ino  # Sensor node ESP32-C3 firmware
├── backend/
│   ├── server.js              # Node.js WebSocket + REST API + TimescaleDB
│   └── package.json
├── db_init.sql                # TimescaleDB schema
└── docker-compose.yml         # Docker for TimescaleDB
```

---

# 5. Module Summary

### BluetoothService
- **Purpose:** Kết nối phần cứng (ESP32) qua BLE hoặc USB Serial
- **Input:** BLE notifications (binary 80-byte frames) hoặc USB serial text lines
- **Output:** `RAW_DATA_RECEIVED` events (raw string or pre-parsed object)
- **Dependencies:** EventBus, Constants, SensorData (IMUReading)
- **Important Functions:** `connectBLE()`, `connectUSB()`, `_parseBinaryFrame(dv)`, `_scanBinaryBuffer()`, `_attemptReconnect()`

### DataParser
- **Purpose:** Tự động detect và parse multiple data formats (JSON, CSV, SSV)
- **Input:** Raw string line từ serial/BLE
- **Output:** Structured `{ timestamp, readings|orientations, mode }` object
- **Dependencies:** SensorData (IMUReading), Constants (SEGMENT_BY_INDEX)
- **Important Functions:** `parse(line)`, `_parseJSON()`, `_parseCSV()`, `_parseSSV()`

### SensorFusion
- **Purpose:** Chuyển đổi raw IMU → orientation (Euler) → joint angles
- **Input:** Object of IMUReading per segment
- **Output:** `{ orientations, jointAngles }`
- **Dependencies:** MadgwickFilter, CalibrationData, MathUtils, SensorData
- **Important Functions:** `process(readings)`, `processCalibration(readings)`, `_computeJointAngles(orientations)`

### MadgwickFilter (Madgwick6DOF)
- **Purpose:** AHRS filter — fuse accel + gyro → quaternion orientation
- **Input:** gx, gy, gz (rad/s), ax, ay, az (m/s²)
- **Output:** Quaternion [q0,q1,q2,q3], Euler {roll, pitch, yaw}
- **Dependencies:** None (self-contained)
- **Important Functions:** `updateIMU(gx,gy,gz,ax,ay,az)`, `getEulerDeg()`, `getQuaternion()`

### DataProcessingViewModel
- **Purpose:** Orchestrate toàn bộ data pipeline; trung tâm xử lý dữ liệu
- **Input:** `RAW_DATA_RECEIVED` events
- **Output:** `PROCESSED_DATA_READY` events (SensorDataSample)
- **Dependencies:** DataParser, SensorFusion, SignalProcessing, SessionData, WebSocketClient
- **Important Functions:** `_processLine()`, `_processRawIMU()`, `_processOrientation()`, `_applyLowPass()`

### Arm3DView & Arm3DViewHumanoid
- **Purpose:** 3D visualization của cánh tay. `Arm3DViewHumanoid` dùng mô hình 3D thật (GLB/Mixamo) với skeleton. `Arm3DView` là fallback với các khối cylinder cơ bản.
- **Input:** `PROCESSED_DATA_READY` events, `EXERCISE_GUIDE_START/STOP` events
- **Output:** Three.js rendered canvas
- **Dependencies:** Three.js (CDN global), EventBus, Constants
- **Important Functions:** `init()`, `calibrateZero()`, `destroy()`

### ExerciseGuidance
- **Purpose:** Library 4 bài tập phục hồi + real-time feedback
- **Input:** `PROCESSED_DATA_READY` events (khi bài tập đang active)
- **Output:** `EXERCISE_GUIDE_START/STOP` events (notify Arm3DView)
- **Dependencies:** EventBus, Constants
- **Important Functions:** `init()`, `startExercise(key)`, `stopExercise()`, `_evaluateTargets()`, `_generateFeedback()`

### SessionData
- **Purpose:** Ring buffer lưu trữ time-series data, tính statistics & ROM
- **Input:** SensorDataSample
- **Output:** Time series arrays, statistics, ROM values, CSV/JSON export
- **Dependencies:** Constants, MathUtils
- **Important Functions:** `addSample()`, `getTimeSeries(path)`, `getStats(path)`, `getROM()`, `toCSV()`, `toJSON()`

### SignalProcessing
- **Purpose:** DSP utilities cho phân tích tín hiệu
- **Input:** Number arrays (time series)
- **Output:** Filtered data, FFT results, SPARC smoothness, peak detection
- **Dependencies:** MathUtils
- **Important Functions:** `fft()`, `sparc()`, `lowPassFilter()`, `medianFilter()`, `findPeaks()`, `dominantFrequency()`

---

# 6. Pipeline Flow

## Pipeline 1: RAW IMU Mode (Default)

```
ESP32 Sensor Node (MPU6050 @ 50Hz)
    ↓ ESP-NOW (TDMA slots)
Master ESP32
    ↓ BLE 80-byte frame / USB Serial
BluetoothService._parseBinaryFrame()
    ↓ RAW_DATA_RECEIVED event
DataProcessingViewModel._processParsedData()
    ↓
DataParser.parse() [if text mode]
    ↓
Low-Pass IIR Filter (α=0.2) [optional]
    ↓
CalibrationData.applyCalibration()
  → Accel: M × (raw×9.8 − bias) → m/s²
  → Gyro: K × (raw + bias) → °/s
    ↓
SensorFusion.process()
  → Madgwick6DOF.updateIMU() → Quaternion
  → getEulerDeg() → {roll, pitch, yaw}
  → Subtract calibration offsets
    ↓
SensorFusion._computeJointAngles()
  → Shoulder Flexion = |pitch_upper_arm|
  → Shoulder Abduction = |roll_upper_arm|
  → Elbow Flexion = max(0, pitch_forearm − pitch_upper)
  → Wrist Flexion = pitch_wrist − pitch_forearm
    ↓
new SensorDataSample(timestamp, frame, raw, orientation, jointAngles)
    ↓
SessionData.addSample() [ring buffer, ROM tracking]
    ↓
PROCESSED_DATA_READY event
    ↓
┌───────────────────┬─────────────────┬──────────────────┐
│ ChartView         │ Arm3DView       │ ExerciseGuidance │
│ (Chart.js render) │ (Three.js 3D)   │ (feedback)       │
└───────────────────┴─────────────────┴──────────────────┘
    ↓
WebSocketClient.sendFrame() → Backend → TimescaleDB
```

## Pipeline 2: ORIENTATION Mode (Pre-fused from ESP32)

```
ESP32 sends {r, p, y} per sensor (already fused on-device)
    ↓ RAW_DATA_RECEIVED
DataProcessingViewModel._processOrientation()
    ↓
Subtract calibration offsets
    ↓
computeJointAngles() [same as above]
    ↓
SensorDataSample → SessionData → PROCESSED_DATA_READY
```

---

# 7. Tracking Logic

### Sensor Placement (6 nodes)
| Node ID | Segment | Vị trí gắn |
|---------|---------|-------------|
| 1 | left_upper_arm | Cánh tay trên trái (giữa vai-khuỷu) |
| 2 | left_forearm | Cẳng tay trái (giữa khuỷu-cổ tay) |
| 3 | left_wrist | Cổ tay trái (mu bàn tay) |
| 4 | right_upper_arm | Cánh tay trên phải |
| 5 | right_forearm | Cẳng tay phải |
| 6 | right_wrist | Cổ tay phải |

### Orientation Estimation
- Mỗi sensor: Madgwick 6DOF filter (accel + gyro) → quaternion → Euler angles (ZYX convention)
- Beta = 0.1 (default), configurable 0.01–0.5
- Sample rate = 50 Hz

### Joint Angle Computation
```
Shoulder Flexion  = |pitch_upper_arm|
Shoulder Abduction = |roll_upper_arm|
Elbow Flexion     = max(0, pitch_forearm − pitch_upper_arm)
Wrist Flexion     = pitch_wrist − pitch_forearm
Wrist Deviation   = yaw_wrist − yaw_forearm
```

### Calibration
1. **Static calibration (runtime):** Thu thập 200 mẫu gyro ở trạng thái nghỉ → tính gyro bias trung bình → trừ bias khi xử lý
2. **Orientation zero-reference:** Lưu orientation tại tư thế nghỉ sau calibration → trừ offset cho tất cả mẫu sau đó
3. **Factory calibration (CalibrationData.js):** Ma trận 3×3 cho accel, scale factor + bias cho gyro (từ lab calibration)

### Coordinate System
- Convention: ZYX Euler angles (Yaw-Pitch-Roll)
- Right-hand coordinate system
- Quaternion: [w, x, y, z] = [q0, q1, q2, q3]

### Time Synchronization
- Master ESP32 broadcast `SyncPacket_t {type=0x01, master_time}` mỗi 1 giây
- Sensor nodes tính `timeOffsetMs = master_time - millis()` và gửi timestamp đã đồng bộ
- TDMA slotting: mỗi node gửi trong khe 3ms riêng (Node1: 0-3ms, Node2: 3-6ms, ...) trong chu kỳ 20ms

---

# 8. Mathematical Model

### Madgwick Filter (6DOF)
**Mục tiêu:** Ước lượng quaternion orientation q từ gyroscope và accelerometer

**Quaternion derivative (gyroscope):**
```
q̇ = 0.5 × q ⊗ [0, gx, gy, gz]
```

**Gradient descent correction (accelerometer):**
```
∇f = Jᵀ × f(q, â)
```
Trong đó f(q, â) là hàm objective đo sai lệch giữa trọng lực đo được và trọng lực mong đợi.

**Fusion update:**
```
q̇_fused = q̇_gyro − β × ∇f / |∇f|
q(t+dt) = q(t) + q̇_fused × dt
q = q / |q|   (normalize)
```

- β (beta): trọng số cho correction (0.1 default)
- Cao → fast convergence, nhiều noise
- Thấp → smooth nhưng chậm sửa gyro drift

### Euler Angle Extraction (ZYX)
```
roll  = atan2(2(q0q1 + q2q3), 1 − 2(q1² + q2²))
pitch = asin(clamp(2(q0q2 − q3q1), −1, 1))
yaw   = atan2(2(q0q3 + q1q2), 1 − 2(q2² + q3²))
```

### Accelerometer Calibration
```
a_calibrated = M × (a_raw × 9.8 − bias)
```
- M: 3×3 scale/cross-coupling matrix (gần identity)
- bias: 3-element vector (m/s²)

### Gyroscope Calibration
```
g_calibrated = K × (g_raw + bias)
```
- K: 3-element per-axis scale factor (gần 1.0)
- bias: 3-element vector (°/s)

### IIR Low-Pass Filter
```
y[n] = α × x[n] + (1−α) × y[n−1]
```
- α = 0.2 (default), per-axis, per-segment

### SPARC (Spectral Arc Length) — Movement Smoothness
```
SPARC = −∑ √(Δf² + Δm²)
```
- Tính trên FFT normalized magnitude spectrum của velocity profile
- Closer to 0 = smoother movement
- Reference: Balasubramanian et al. 2012

---

# 9. Data Structures

### IMUReading (Immutable)
```
{ ax, ay, az, gx, gy, gz }  // g, °/s
Properties: accelMagnitude, gyroMagnitude
```

### Orientation (Immutable)
```
{ roll, pitch, yaw }  // degrees
```

### JointAngles
```
{
  leftShoulderFlexion, leftShoulderAbduction,
  leftElbowFlexion, leftWristFlexion, leftWristDeviation,
  rightShoulderFlexion, rightShoulderAbduction,
  rightElbowFlexion, rightWristFlexion, rightWristDeviation
}  // degrees
```

### SensorDataSample
```
{
  timestamp: number (ms),
  frameIndex: number,
  raw: { [segment]: IMUReading },
  orientation: { [segment]: Orientation },
  jointAngles: JointAngles
}
```

### BLE Binary Frame (80 bytes)
```
Byte 0:     0xAA (header)
Byte 1:     active_mask (6-bit bitmask)
Byte 2-5:   timestamp (uint32 LE, ms)
Byte 6-77:  6 nodes × 12 bytes (ax,ay,az,gx,gy,gz as int16 LE)
Byte 78:    checksum (XOR bytes 0-77)
Byte 79:    0x55 (footer)
```

### ESP-NOW NodePacket (packed struct)
```
{ node_id: u8, timestamp: u32, ax: i16, ay: i16, az: i16, gx: i16, gy: i16, gz: i16, seq: u8 }
```

### Exercise Definition
```
{
  name: string, description: string,
  targets: { [angleName]: { min, max, optimal } },
  duration: number (s), reps: number,
  instructions: string[]
}
```

---

# 10. External Dependencies

| Dependency | Purpose | Location |
|-----------|---------|----------|
| **Three.js 0.158.0** | 3D arm visualization | CDN (cdnjs) |
| **Chart.js** | Real-time data charts | CDN (cdnjs) |
| **Web Bluetooth API** | BLE connection to ESP32 | Browser native |
| **Web Serial API** | USB connection to ESP32 | Browser native |
| **ESP-NOW** | Wireless inter-ESP32 comm | ESP32 SDK |
| **BLE (NUS)** | Nordic UART Service | ESP32 Arduino BLE lib |
| **MPU6050** | IMU sensor IC | Hardware (I2C) |
| **Node.js** | Backend server | backend/server.js |
| **ws** (npm) | WebSocket server | backend/ |
| **pg** (npm) | PostgreSQL client | backend/ |
| **TimescaleDB** | Time-series database | Docker |
| **Express** | REST API server | backend/ |

---

# 11. Configuration

### Sensor Config (`SENSOR_CONFIG`)
| Parameter | Value | Meaning |
|-----------|-------|---------|
| `BAUD_RATE` | 115200 | USB Serial baud rate |
| `SAMPLE_RATE_HZ` | 50 | Target sensor sample rate |
| `SAMPLE_INTERVAL_MS` | 20 | 1000/50Hz |
| `NUM_SENSORS` | 6 | Number of MPU6050 nodes |

### Fusion Config (`FUSION_CONFIG`)
| Parameter | Value | Meaning |
|-----------|-------|---------|
| `MADGWICK_BETA` | 0.1 | Filter responsiveness (0.01=smooth, 0.5=fast) |
| `MADGWICK_SAMPLE_HZ` | 50 | Must match actual BLE rate |
| `LOWPASS_ALPHA` | 0.2 | IIR filter smoothness |
| `CALIBRATION_SAMPLES` | 200 | Samples for gyro bias (4s at 50Hz) |

### Buffer Config (`BUFFER_CONFIG`)
| Parameter | Value | Meaning |
|-----------|-------|---------|
| `MAX_SAMPLES` | 500 | Max ring buffer size |
| `CHART_WINDOW` | 200 | Visible chart window (4s) |
| `FFT_SIZE` | 256 | FFT buffer size (power of 2) |

### Chart Config (`CHART_CONFIG`)
| Parameter | Value | Meaning |
|-----------|-------|---------|
| `UPDATE_INTERVAL_MS` | 33 | Chart throttle (~30fps) |
| `ANIMATION_DURATION` | 0 | No animation (real-time perf) |

### MPU6050 Config (Firmware)
| Register | Value | Meaning |
|----------|-------|---------|
| GYRO_CONFIG | 0x00 | ±250°/s (131 LSB/°/s) |
| ACCEL_CONFIG | 0x00 | ±2g (16384 LSB/g) |
| DLPF_CONFIG | 0x03 | 44Hz low-pass |
| SMPLRT_DIV | 0x09 | 100Hz internal rate |

### ESP-NOW TDMA
| Parameter | Value | Meaning |
|-----------|-------|---------|
| SLOT_WIDTH_US | 3000 | 3ms per node slot |
| SYNC_INTERVAL_MS | 1000 | Sync broadcast period |
| SYNC_TIMEOUT_MS | 5000 | Desync detection |

---

# 12. Important Classes

### App (app.js)
- **Purpose:** Bootstrap — wires all MVVM components together
- **Key Methods:** `init()`
- **Dependencies:** All ViewModels + DashboardView

### BluetoothService
- **Purpose:** Hardware I/O abstraction (BLE + USB)
- **Key Methods:** `connectBLE()`, `connectUSB()`, `disconnect()`, `autoConnect()`, `_parseBinaryFrame()`, `_scanBinaryBuffer()`, `_attemptReconnect()`
- **Dependencies:** EventBus, Constants

### DataProcessingViewModel
- **Purpose:** Central pipeline orchestrator
- **Key Methods:** `init()`, `_processLine()`, `_processRawIMU()`, `_processOrientation()`, `_applyLowPass()`, `startCalibration()`, `getFFT()`, `getSPARC()`
- **Dependencies:** DataParser, SensorFusion, SignalProcessing, SessionData, WebSocketClient

### SensorFusion
- **Purpose:** IMU fusion (Madgwick) + joint angle computation
- **Key Methods:** `process(readings)`, `processCalibration()`, `computeJointAngles()`, `setBeta()`, `setSampleRate()`
- **Dependencies:** MadgwickFilter, CalibrationData, MathUtils

### Madgwick6DOF
- **Purpose:** Quaternion-based AHRS filter
- **Key Methods:** `updateIMU()`, `getEulerDeg()`, `getQuaternion()`, `reset()`
- **Dependencies:** None

### DashboardView
- **Purpose:** Main UI renderer — 8 pages, sidebar, header, data binding
- **Key Methods:** `init()`, `renderPage(page)`, `_renderDashboard()`, `_renderRawData()`, `_renderAngles()`, `_renderROM()`, `_renderClinical()`, `_render3DTracking()`, `_renderSettings()`
- **Dependencies:** All ViewModels, ChartView, HistoryView, Arm3DView, Arm3DViewHumanoid, ExerciseGuidance

### Arm3DView & Arm3DViewHumanoid
- **Purpose:** Three.js 3D visualization (Humanoid GLB & Cylinder fallback)
- **Key Methods:** `init()`, `calibrateZero()`, `destroy()`
- **Dependencies:** Three.js, EventBus

### ExerciseGuidance
- **Purpose:** Rehab exercise library with target tracking and feedback
- **Key Methods:** `init()`, `startExercise(key)`, `stopExercise()`, `_evaluateTargets()`, `_generateFeedback()`
- **Dependencies:** EventBus

### EventBus
- **Purpose:** Pub/Sub singleton for decoupled communication
- **Key Methods:** `on(event, cb)`, `once()`, `off()`, `emit(event, data)`, `clear()`
- **Dependencies:** None

---

# 13. Important Functions

| Function | Input | Output | Purpose |
|----------|-------|--------|---------|
| `BluetoothService._parseBinaryFrame(dv)` | DataView (80 bytes) | `{timestamp, readings, mode, activeMask}` | Parse BLE binary frame with checksum verification |
| `DataParser.parse(line)` | Raw string | `{timestamp, readings\|orientations, mode}` | Auto-detect and parse multiple formats |
| `SensorFusion.process(readings)` | `{[seg]: IMUReading}` | `{orientations, jointAngles}` | Full fusion pipeline per frame |
| `Madgwick6DOF.updateIMU(gx,gy,gz,ax,ay,az)` | 6 floats (rad/s, m/s²) | Updates internal quaternion | Core AHRS filter step |
| `applyCalibration(nodeId, ax,ay,az,gx,gy,gz)` | Raw sensor values | Calibrated `{ax,ay,az,gx,gy,gz}` | Apply factory calibration matrices |
| `SignalProcessing.fft(data, sampleRate)` | Number array | `{frequencies, magnitudes}` | Cooley-Tukey radix-2 FFT |
| `SignalProcessing.sparc(velocity, sampleRate)` | Velocity profile | SPARC value (negative float) | Movement smoothness metric |
| `SensorFusion._computeJointAngles(orientations)` | `{[seg]: Orientation}` | JointAngles | Compute clinical joint angles from Euler |
| `Arm3DView._updateGuideAnimation()` | Internal state | Updates 3D meshes | Animate guide arm through exercise motion |

---

# 14. Data Flow Mapping

| Source | Destination | Data Type | Purpose |
|--------|-------------|-----------|---------|
| MPU6050 | Sensor Node | int16 (I2C) | Raw accel/gyro readings |
| Sensor Node → Master | ESP-NOW | NodePacket_t (17 bytes) | Wireless sensor data transfer |
| Master → Browser | BLE/USB | BLEFrame_t (80 bytes) | Aggregated frame delivery |
| BluetoothService → DataProcessingVM | EventBus `RAW_DATA_RECEIVED` | string \| Object | Raw data handoff |
| DataProcessingVM → Views | EventBus `PROCESSED_DATA_READY` | SensorDataSample | Processed data broadcast |
| ExerciseGuidance → Arm3DView | EventBus `EXERCISE_GUIDE_START` | `{targets, name}` | Start guide animation |
| ExerciseGuidance → Arm3DView | EventBus `EXERCISE_GUIDE_STOP` | void | Stop guide animation |
| DataProcessingVM → Backend | WebSocket `frame` | JSON | Persist to TimescaleDB |
| Backend → HistoryView | REST API | JSON | Load session history |
| DashboardVM → DashboardView | EventBus `TAB_CHANGED` | Pages enum | Page navigation |
| ConnectionVM → DashboardView | EventBus `CONNECTION_STATE_CHANGED` | ConnectionState | UI state update |

---

# 15. Performance Considerations

| Area | Detail |
|------|--------|
| **BLE MTU fragmentation** | 80-byte frame may be split across BLE notifications (20-byte MTU). Binary accumulation buffer handles reassembly. |
| **Chart throttle** | Charts update at 30fps (33ms), not every data frame (50Hz), to reduce DOM overhead. |
| **Ring buffer** | SessionData caps at 500 samples (10 seconds at 50Hz). Oldest samples are dropped. |
| **Three.js cleanup** | Arm3DView.destroy() disposes renderer, unsubscribes events, removes resize listener to prevent WebGL context leaks. |
| **Animation** | Chart.js animation disabled (`ANIMATION_DURATION: 0`) for real-time performance. |
| **Low-pass filter** | Per-segment IIR state avoids re-allocation. |
| **FFT** | In-place Cooley-Tukey implementation with Hanning window. |
| **TDMA** | Sensor nodes use time-slotted access (3ms per node in 20ms cycle) to prevent ESP-NOW collisions. |
| **FreeRTOS** | Master firmware uses `delay(1)` to yield CPU for BLE stack (prevents watchdog reset). |
| **Auto-reconnect** | Exponential backoff (1s, 2s, 4s, ... max 10s) for BLE reconnection, max 10 attempts. |

---

# 16. Current Features

| Feature | Status |
|---------|--------|
| BLE connection (Web Bluetooth API) | ✅ Completed |
| USB Serial connection (Web Serial API) | ✅ Completed |
| Auto-reconnect with exponential backoff | ✅ Completed |
| Binary 80-byte BLE protocol with checksum | ✅ Completed |
| Auto-detect data format (JSON/CSV/Binary) | ✅ Completed |
| Madgwick 6DOF sensor fusion | ✅ Completed |
| Factory calibration (matrix + bias) | ✅ Completed |
| Runtime gyro bias calibration | ✅ Completed |
| Orientation zero-reference offset | ✅ Completed |
| Dual-arm (6 sensors) support | ✅ Completed |
| Joint angle computation (5 per arm) | ✅ Completed |
| Real-time charts (raw, RPY, joints, ROM) | ✅ Completed |
| 3D arm visualization (Three.js) | ✅ Completed |
| Guide arm animation for exercises | ✅ Completed |
| Exercise guidance (4 exercises, feedback) | ✅ Completed |
| Clinical analysis (ROM vs. normal) | ✅ Completed |
| Data table view | ✅ Completed |
| CSV/JSON export | ✅ Completed |
| Demo mode (simulated data) | ✅ Completed |
| FFT frequency analysis | ✅ Completed |
| SPARC smoothness metric | ✅ Completed |
| TimescaleDB backend storage | ✅ Completed |
| Session history (REST API) | ✅ Completed |
| ESP32 master firmware (BLE + ESP-NOW) | ✅ Completed |
| ESP32-C3 sensor node firmware (TDMA) | ✅ Completed |
| Per-node individual calibration | ⚠️ Partial (uses shared default matrix) |
| 3D connected kinematic chain (real model) | ✅ Completed (via Arm3DViewHumanoid GLB skeleton) |
| Magnetometer fusion (9DOF) | ❌ Missing (yaw drift) |
| Persistent calibration storage | ❌ Missing |
| Multi-patient database management | ❌ Missing |
| PDF report generation | ❌ Missing |
| Mobile responsive design | ⚠️ Partial |

---

# 17. Technical Decisions

| Decision | Rationale |
|----------|-----------|
| **Madgwick over Kalman** | Madgwick is computationally lighter (no matrix inversion), runs well in JavaScript at 50Hz, and provides comparable accuracy for IMU-only fusion. |
| **6DOF (no magnetometer)** | MPU6050 has no magnetometer. Yaw drift is accepted as trade-off for simpler/cheaper hardware. Runtime calibration zeros yaw at start. |
| **EventBus (Pub/Sub)** | Decouples all components. Services, ViewModels, and Views communicate without direct references. Easy to add new subscribers. |
| **MVVM architecture** | Clean separation: Models hold data, ViewModels hold logic, Views handle DOM. Matches well with EventBus-driven reactivity. |
| **Vanilla JS (no framework)** | Zero build step. Open `index.html` with Live Server and it works. No npm/webpack needed for frontend. |
| **BLE Binary protocol** | 80-byte binary frame is 5x more efficient than JSON text (~400 bytes). Critical at 50Hz BLE throughput. |
| **ESP-NOW for inter-node comm** | Low latency (<1ms), no pairing needed, broadcast support. WiFi must be STA mode. |
| **TDMA slot scheduling** | Prevents ESP-NOW collision between 6 nodes. Each node has a 3ms slot within the 20ms cycle. |
| **Three.js for 3D** | Mature WebGL library, good for real-time rendering. CDN loading avoids build tooling. |
| **TimescaleDB** | Time-series optimized PostgreSQL extension. Perfect for high-frequency sensor data storage. |
| **Guide arm as kinematic chain** | Connected parent-child hierarchy in Three.js. Rotating shoulder automatically moves elbow→wrist. Realistic movement demo. |

---

# 18. Known Issues

| Issue | Severity | Detail |
|-------|----------|--------|
| **Yaw drift** | Medium | Madgwick 6DOF without magnetometer → yaw accumulates error over time. Workaround: periodic recalibration. |
| **Shared calibration** | Low | All 6 nodes use same default calibration matrix from CalibrationData.js. Should be per-node. |
| **SessionData CSV export** | Low | `toCSV()` still uses legacy single-arm `ArmSegment.UPPER_ARM/FOREARM/WRIST` keys (not dual-arm). |
| **3D real model disconnected** | Low | Đã được giải quyết bằng `Arm3DViewHumanoid`. Chỉ còn xảy ra nếu fallback về cylinder model. |
| **WebSocket reconnect loop** | Low | WebSocketClient reconnects every 3s to backend even when backend is not running (console noise). |
| **BLE MTU** | Low | Some Android browsers have smaller BLE MTU, potentially causing more fragmentation. Buffer handles it but may add latency. |
| **Demo mode single arm** | Low | ConnectionViewModel demo only generates data for 2 sensors (s1, s2), not full 6-sensor setup. |

---

# 19. Future Improvements

| Category | Improvement |
|----------|-------------|
| **Accuracy** | Add magnetometer support (9DOF) with MPU9250/ICM-20948 to fix yaw drift |
| **Accuracy** | Per-node individual calibration with automated calibration wizard |
| **3D Model** | Cải thiện texture và lighting cho mô hình Humanoid |
| **3D Model** | Add body torso reference mesh for anatomical context |
| **Exercise** | More exercises: pronation/supination, wrist circles, combined patterns |
| **Exercise** | Rep counting algorithm based on peak detection in joint angle signals |
| **Backend** | Multi-patient management with authentication |
| **Backend** | PDF report generation with ROM charts and clinical summary |
| **Optimization** | Web Worker for Madgwick computation (offload main thread) |
| **Optimization** | Binary WebSocket protocol for backend (instead of JSON) |
| **Mobile** | Responsive sidebar collapse, touch-friendly controls |
| **Research** | Compare IMU-based ROM with camera-based (Kinect/MediaPipe) for validation |
| **Research** | Machine learning-based exercise quality scoring |

---

# 20. AI Memory Section

## AI_CONTEXT

**Dự án ArmTrack** là hệ thống theo dõi chuyển động chi trên (dual-arm) real-time phục vụ phục hồi chức năng, được xây dựng dưới dạng đồ án tốt nghiệp (DATN).

**Phần cứng:** 6 ESP32-C3 (sensor nodes) gắn MPU6050 IMU đọc accel/gyro ở 50Hz, truyền qua ESP-NOW (TDMA slots 3ms/node) tới 1 ESP32 master. Master đóng gói 80-byte BLE binary frame (0xAA header, 6×12B data, XOR checksum, 0x55 footer) và gửi tới browser qua BLE Nordic UART Service hoặc USB Serial.

**Frontend:** Pure Vanilla JS (ES Modules), kiến trúc MVVM, giao tiếp qua EventBus (Pub/Sub singleton). Không cần build tool — mở index.html với Live Server là chạy.

**Pipeline xử lý dữ liệu:**
1. `BluetoothService` nhận BLE/USB data → auto-detect binary/text → emit `RAW_DATA_RECEIVED`
2. `DataProcessingViewModel` orchestrate: `DataParser` (auto-detect JSON/CSV/Binary) → Low-Pass IIR (α=0.2) → `CalibrationData` (matrix correction) → `SensorFusion` (Madgwick 6DOF → quaternion → Euler) → `_computeJointAngles()` → `SensorDataSample` → `SessionData` (ring buffer 500) → emit `PROCESSED_DATA_READY`
3. Views subscribe: `ChartView` (Chart.js), `Arm3DView` (Three.js 3D), `ExerciseGuidance` (4 bài tập rehab)

**Sensor Fusion:** Madgwick 6DOF filter với beta=0.1, convention ZYX. Raw (g, °/s) → factory calibration → gyro bias removal → Madgwick (rad/s, m/s²) → quaternion → Euler → subtract zero-reference offset. Joint angles tính từ difference giữa segment orientations.

**3D Visualization:** Giao diện Tracking 3D hiện tại:
- **Humanoid Model (Chính):** Sử dụng `Arm3DViewHumanoid` load mô hình GLB (Mixamo) có skeleton, liên kết thành kinematic chain mượt mà. Hỗ trợ zero-pose calibration qua `calibrateZero()`.
- **Cylinder Model (Fallback):** `Arm3DView` dự phòng nếu load GLB thất bại, hiển thị khối rời rạc.
- **Exercise Guidance:** Tích hợp chung vào view 3D, dùng `ExerciseAnimator` hướng dẫn form. Communication qua `EXERCISE_GUIDE_START/STOP` events.

**Backend:** Node.js WebSocket server → TimescaleDB (Docker). REST API `/api/sessions` cho history view.

**8 pages:** Dashboard overview, Raw Sensor Data, Angle (RPY & Joints), Range of Motion, Clinical Analysis, 3D Tracking & Exercise, Data Table, Settings.

**Quan trọng khi sửa code:**
- `EventBus` singleton tại `js/utils/EventBus.js` — mọi communication đều qua đây
- `Constants.js` chứa tất cả config, enums, event names — luôn check trước khi thêm mới
- Three.js load qua CDN global `THREE`, KHÔNG import — URL version `0.158.0` (KHÔNG phải `r158`)
- `Arm3DView` và `ExerciseGuidance` cần `destroy()` khi navigate khỏi trang 3D (tránh memory leak)
- DashboardView.renderPage() cleanup 3D views trước khi render trang mới
- Segments mapping: SEGMENT_BY_INDEX[1-6] = left_upper → left_forearm → left_wrist → right_upper → right_forearm → right_wrist
