/**
 * Constants - Application-wide configuration values
 */

// ── Sensor Configuration ──
export const SENSOR_CONFIG = {
  BAUD_RATE: 115200,
  SAMPLE_RATE_HZ: 50,
  SAMPLE_INTERVAL_MS: 20, // 1000 / 50Hz
  NUM_SENSORS: 6,         // 6 MPU6050 nodes
};

// ── Sensor Segments (6 nodes - Dual Arm Setup) ──
export const ArmSegment = Object.freeze({
  LEFT_UPPER_ARM: 'left_upper_arm',
  LEFT_FOREARM: 'left_forearm',
  LEFT_WRIST: 'left_wrist',
  RIGHT_UPPER_ARM: 'right_upper_arm',
  RIGHT_FOREARM: 'right_forearm',
  RIGHT_WRIST: 'right_wrist',
});

// Mapping: node_ID (1-6) → ArmSegment key
export const SEGMENT_BY_INDEX = [
  null,                       // index 0 unused
  ArmSegment.LEFT_UPPER_ARM,  // node 1
  ArmSegment.LEFT_FOREARM,    // node 2
  ArmSegment.LEFT_WRIST,      // node 3
  ArmSegment.RIGHT_UPPER_ARM, // node 4
  ArmSegment.RIGHT_FOREARM,   // node 5
  ArmSegment.RIGHT_WRIST,     // node 6
];

export const SEGMENT_LABELS = {
  [ArmSegment.LEFT_UPPER_ARM]: 'L-Shoulder (Vai Trái)',
  [ArmSegment.LEFT_FOREARM]: 'L-Elbow (Khuỷu Trái)',
  [ArmSegment.LEFT_WRIST]: 'L-Wrist (Cổ tay Trái)',
  [ArmSegment.RIGHT_UPPER_ARM]: 'R-Shoulder (Vai Phải)',
  [ArmSegment.RIGHT_FOREARM]: 'R-Elbow (Khuỷu Phải)',
  [ArmSegment.RIGHT_WRIST]: 'R-Wrist (Cổ tay Phải)',
};

export const SEGMENT_COLORS = {
  [ArmSegment.LEFT_UPPER_ARM]: '#3b82f6',  // Blue
  [ArmSegment.LEFT_FOREARM]: '#06b6d4',    // Cyan
  [ArmSegment.LEFT_WRIST]: '#8b5cf6',      // Purple
  [ArmSegment.RIGHT_UPPER_ARM]: '#ef4444', // Red
  [ArmSegment.RIGHT_FOREARM]: '#f97316',   // Orange
  [ArmSegment.RIGHT_WRIST]: '#eab308',     // Yellow
};

// ── Axis Colors ──
export const AXIS_COLORS = {
  x: '#ef4444',
  y: '#22c55e',
  z: '#3b82f6',
};

// ── Buffer Configuration ──
export const BUFFER_CONFIG = {
  MAX_SAMPLES: 500,        // Max data points to keep in memory
  CHART_WINDOW: 200,       // Visible window on chart (200 frames = 4 seconds at 50Hz)
  FFT_SIZE: 256,           // FFT buffer size (power of 2)
};

// ── Chart Configuration ──
export const CHART_CONFIG = {
  UPDATE_INTERVAL_MS: 33,  // Chart update throttle (30fps for charts)
  ANIMATION_DURATION: 0,   // No animation for real-time (performance)
  POINT_RADIUS: 0,         // No points for line charts (performance)
  LINE_WIDTH: 1.5,
  GRID_COLOR: 'rgba(148, 163, 184, 0.08)',
  TICK_COLOR: 'rgba(148, 163, 184, 0.5)',
  FONT_FAMILY: "'Inter', sans-serif",
  FONT_SIZE: 11,
};

// ── Normal ROM Values (degrees) ──
export const NORMAL_ROM = {
  shoulder_flexion: { min: 0, max: 180, label: 'Shoulder Flexion' },
  shoulder_extension: { min: 0, max: 60, label: 'Shoulder Extension' },
  shoulder_abduction: { min: 0, max: 180, label: 'Shoulder Abduction' },
  elbow_flexion: { min: 0, max: 150, label: 'Elbow Flexion' },
  elbow_extension: { min: 0, max: 10, label: 'Elbow Extension' },
  wrist_flexion: { min: 0, max: 80, label: 'Wrist Flexion' },
  wrist_extension: { min: 0, max: 70, label: 'Wrist Extension' },
  wrist_radial: { min: 0, max: 20, label: 'Wrist Radial Dev.' },
  wrist_ulnar: { min: 0, max: 30, label: 'Wrist Ulnar Dev.' },
};

// ── Sensor Fusion Configuration ──
export const FUSION_CONFIG = {
  MADGWICK_BETA: 0.1,             // Madgwick filter gain (0.01=smooth, 0.5=responsive)
  MADGWICK_SAMPLE_HZ: 50,        // Must match actual BLE frame rate
  LOWPASS_ALPHA: 0.2,           // Low-pass filter coefficient
  CALIBRATION_SAMPLES: 200,     // Samples for gyro calibration (4 seconds at 50Hz)

  // ── ZARU (Zero Angular Rate Update) — bù trôi bias gyro lúc chạy ──
  // Khi cảm biến đứng yên, vận tốc góc thật = 0 nên gyro đo được CHÍNH LÀ bias.
  // ZARU theo dõi và cập nhật chậm gyroBias để bù trôi nhiệt/thời gian (Wang 2024:
  // "scale factor và bias đổi mỗi lần khởi động / theo điều kiện môi trường").
  ZARU_ENABLED: true,
  ZARU_GYRO_THRESH_DPS: 1.5,    // |ω| < ngưỡng (°/s) thì coi là đứng yên
  ZARU_ACCEL_TOL_MS2: 0.6,      // |‖a‖ − g| < ngưỡng (m/s²) để chắc chắn không chuyển động
  ZARU_MIN_SAMPLES: 25,         // số mẫu đứng yên liên tục trước khi bắt đầu cập nhật
  ZARU_ALPHA: 0.02,             // hệ số low-pass cập nhật bias (nhỏ = bám chậm, mượt)

  // ── Tích phân theo Δt thực (thay vì giả định cố định 1/sampleFreq) ──
  // Δt đo từ timestamp của master; kẹp trong [MIN,MAX] để 1 lần rớt gói / khe TDMA
  // không gây bước tích phân quá lớn (≈ tối đa 3 frame ở 50Hz).
  DT_MIN_S: 0.002,
  DT_MAX_S: 0.075,

  // ── Khử trôi yaw cho góc lệch cổ tay (wrist deviation) ──
  // MPU6050 không có từ kế → yaw chỉ tích phân gyro nên trôi chậm. Lệch cổ tay
  // (hiệu yaw) vì thế tự trôi. High-pass rò rỉ kéo baseline về 0 với hằng số thời
  // gian ≈ 1/leak mẫu (0.002 → ~10s @50Hz): bỏ trôi chậm, giữ cử động thật.
  YAW_DRIFT_LEAK: 0.002,
};

// ── Connection States ──
export const ConnectionState = Object.freeze({
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DEMO: 'demo',
  ERROR: 'error',
});

// ── Event Names ──
export const Events = Object.freeze({
  // Connection
  CONNECTION_STATE_CHANGED: 'connection:stateChanged',
  CONNECTION_ERROR: 'connection:error',

  // Data
  RAW_DATA_RECEIVED: 'data:rawReceived',
  PROCESSED_DATA_READY: 'data:processedReady',
  CALIBRATION_PROGRESS: 'data:calibrationProgress',
  CALIBRATION_COMPLETE: 'data:calibrationComplete',

  // Session
  RECORDING_STARTED: 'session:recordingStarted',
  RECORDING_STOPPED: 'session:recordingStopped',
  SESSION_EXPORTED: 'session:exported',
  SESSIONS_CHANGED: 'session:storeChanged',

  // UI
  TAB_CHANGED: 'ui:tabChanged',
  CHART_RESIZED: 'ui:chartResized',
  FILTER_CHANGED: 'ui:filterChanged',
  THEME_CHANGED: 'ui:themeChanged',

  // Exercise Guide
  EXERCISE_GUIDE_START: 'exercise:guideStart',
  EXERCISE_GUIDE_STOP: 'exercise:guideStop',
});

// ── Navigation Pages ──
export const Pages = Object.freeze({
  DASHBOARD: 'dashboard',
  RAW_DATA: 'raw-data',
  ANGLE: 'angle',
  ROM: 'rom',
  CLINICAL: 'clinical',
  DATA_TABLE: 'data-table',
  TRACKING_3D: '3d-tracking',
  SETTINGS: 'settings',
});

export const PAGE_CONFIG = {
  [Pages.DASHBOARD]: { label: 'Tổng quan' },
  [Pages.RAW_DATA]: { label: 'Dữ liệu cảm biến' },
  [Pages.ANGLE]: { label: 'Góc khớp (RPY & Khớp)' },
  [Pages.ROM]: { label: 'Phạm vi chuyển động' },
  [Pages.CLINICAL]: { label: 'Phân tích lâm sàng' },
  [Pages.TRACKING_3D]: { label: 'Theo dõi trực tiếp' },
  [Pages.DATA_TABLE]: { label: 'Bảng dữ liệu' },
  history: { label: 'Lịch sử buổi tập (CSDL)' },
  sessions: { label: 'Buổi tập' },
  [Pages.SETTINGS]: { label: 'Cài đặt' },
};

// ── User Roles (giao diện phân vai) ──
export const Roles = Object.freeze({
  PATIENT: 'patient',
  DOCTOR: 'doctor',
});

export const ROLE_LABELS = {
  [Roles.PATIENT]: 'Bệnh nhân',
  [Roles.DOCTOR]: 'Bác sĩ',
};

/**
 * Sidebar navigation grouped into sections, each visible only to the given roles.
 * The sidebar is rendered from this structure (no static HTML / no emoji).
 */
export const NAV_SECTIONS = [
  {
    label: 'Tổng quan',
    roles: [Roles.PATIENT, Roles.DOCTOR],
    items: [{ page: Pages.DASHBOARD, label: 'Tổng quan' }],
  },
  {
    label: 'Theo dõi & Tập luyện',
    roles: [Roles.PATIENT],
    items: [
      { page: Pages.TRACKING_3D, label: 'Theo dõi trực tiếp' },
      { page: Pages.ANGLE, label: 'Góc khớp' },
      { page: 'sessions', label: 'Buổi tập của tôi' },
    ],
  },
  {
    label: 'Phân tích lâm sàng',
    roles: [Roles.DOCTOR],
    items: [
      { page: Pages.CLINICAL, label: 'Phân tích lâm sàng' },
      { page: Pages.ROM, label: 'Phạm vi chuyển động' },
    ],
  },
  {
    label: 'Buổi tập & Dữ liệu',
    roles: [Roles.DOCTOR],
    items: [
      { page: 'sessions', label: 'Buổi tập (cục bộ)' },
      { page: 'history', label: 'Lịch sử (CSDL)' },
      { page: Pages.RAW_DATA, label: 'Dữ liệu cảm biến' },
      { page: Pages.DATA_TABLE, label: 'Bảng dữ liệu' },
    ],
  },
  {
    label: 'Hệ thống',
    roles: [Roles.PATIENT, Roles.DOCTOR],
    items: [{ page: Pages.SETTINGS, label: 'Cài đặt' }],
  },
];

