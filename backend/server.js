const { Pool } = require('pg');
const WebSocket = require('ws');
const express = require('express');
const cors = require('cors');

// --- Cấu hình Múi giờ UTC+7 ---
process.env.TZ = 'Asia/Ho_Chi_Minh';

// --- Cấu hình Express ---
const app = express();
app.use(cors()); // Cho phép gọi API từ giao diện Web

// --- Cấu hình Database (TimescaleDB) ---
const pool = new Pool({
  user: 'admin',
  host: 'localhost',
  database: 'arm_tracking',
  password: 'adminpassword',
  port: 5432,
});

pool.connect()
  .then(async () => {
    console.log('✅ Kết nối thành công tới TimescaleDB!');
    // Thiết lập múi giờ cho session database
    await pool.query("SET TIME ZONE 'Asia/Ho_Chi_Minh'");
  })
  .catch(err => console.error('❌ Lỗi kết nối DB:', err.stack));

// --- Khởi tạo HTTP Server & WebSocket Server ---
const server = app.listen(8080, () => {
  console.log('📡 HTTP & WebSocket Server đang chạy ở cổng 8080...');
});

const wss = new WebSocket.Server({ server });

let currentSessionId = null;
let currentPatientName = null;

wss.on('connection', (ws) => {
  console.log('💻 Dashboard đã kết nối!');

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);

      if (data.type === 'start_session') {
        const crypto = require('crypto');
        currentSessionId = crypto.randomUUID();
        currentPatientName = data.patientName || 'Không rõ';
        console.log(`\n▶️ Bắt đầu lưu phiên mới: ${currentSessionId} - Bệnh nhân: ${currentPatientName}`);
      } 
      else if (data.type === 'stop_session') {
        console.log(`⏹ Kết thúc phiên lưu: ${currentSessionId}`);
        currentSessionId = null;
        currentPatientName = null;
      } 
      else if (data.type === 'frame' && currentSessionId) {
        // Lưu dữ liệu vào DB
        await insertFrameToDB(data.frame);
      }
    } catch (err) {
      console.error('Lỗi khi xử lý tin nhắn:', err);
    }
  });

  ws.on('close', () => console.log('❌ Dashboard đã ngắt kết nối.'));
});

// --- Hàm lưu dữ liệu vào TimescaleDB ---
async function insertFrameToDB(f) {
  const query = `
    INSERT INTO sensor_data (
      time, session_id, frame_index, active_mask,
      n1_ax, n1_ay, n1_az, n1_gx, n1_gy, n1_gz,
      n2_ax, n2_ay, n2_az, n2_gx, n2_gy, n2_gz,
      n3_ax, n3_ay, n3_az, n3_gx, n3_gy, n3_gz,
      n4_ax, n4_ay, n4_az, n4_gx, n4_gy, n4_gz,
      n5_ax, n5_ay, n5_az, n5_gx, n5_gy, n5_gz,
      n6_ax, n6_ay, n6_az, n6_gx, n6_gy, n6_gz,
      left_shoulder_flexion, left_shoulder_abduction, left_elbow_flexion, left_wrist_flexion, left_wrist_deviation,
      right_shoulder_flexion, right_shoulder_abduction, right_elbow_flexion, right_wrist_flexion, right_wrist_deviation,
      patient_name
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15, $16,
      $17, $18, $19, $20, $21, $22,
      $23, $24, $25, $26, $27, $28,
      $29, $30, $31, $32, $33, $34,
      $35, $36, $37, $38, $39, $40,
      $41, $42, $43, $44, $45,
      $46, $47, $48, $49, $50,
      $51
    )
  `;

  // Helper để lấy giá trị hoặc null
  const n = (nodeIndex, key) => f[`n${nodeIndex}`] ? f[`n${nodeIndex}`][key] : null;
  const j = f.jointAngles || {};

  const values = [
    new Date(f.timestampAbsolute), // $1
    currentSessionId,              // $2
    f.frameIndex,                  // $3
    f.activeMask,                  // $4
    // Node 1
    n(1,'ax'), n(1,'ay'), n(1,'az'), n(1,'gx'), n(1,'gy'), n(1,'gz'),
    // Node 2
    n(2,'ax'), n(2,'ay'), n(2,'az'), n(2,'gx'), n(2,'gy'), n(2,'gz'),
    // Node 3
    n(3,'ax'), n(3,'ay'), n(3,'az'), n(3,'gx'), n(3,'gy'), n(3,'gz'),
    // Node 4
    n(4,'ax'), n(4,'ay'), n(4,'az'), n(4,'gx'), n(4,'gy'), n(4,'gz'),
    // Node 5
    n(5,'ax'), n(5,'ay'), n(5,'az'), n(5,'gx'), n(5,'gy'), n(5,'gz'),
    // Node 6
    n(6,'ax'), n(6,'ay'), n(6,'az'), n(6,'gx'), n(6,'gy'), n(6,'gz'),
    // Góc khớp Trái
    j.leftShoulderFlexion || 0,
    j.leftShoulderAbduction || 0,
    j.leftElbowFlexion || 0,
    j.leftWristFlexion || 0,
    j.leftWristDeviation || 0,
    // Góc khớp Phải
    j.rightShoulderFlexion || 0,
    j.rightShoulderAbduction || 0,
    j.rightElbowFlexion || 0,
    j.rightWristFlexion || 0,
    j.rightWristDeviation || 0,
    // Tên bệnh nhân
    currentPatientName || null
  ];

  try {
    await pool.query(query, values);
  } catch (err) {
    console.error('Lỗi khi INSERT:', err.message);
  }
}

// ==========================================
// THÊM API RESTFUL CHO TÍNH NĂNG HISTORY
// ==========================================

// API 1: Lấy danh sách tất cả các phiên tập đã lưu
app.get('/api/sessions', async (req, res) => {
  try {
    // Truy vấn gộp nhóm theo session_id
    const query = `
      SELECT 
        session_id,
        MIN(time) as start_time,
        MAX(time) as end_time,
        COUNT(*) as total_frames,
        MAX(patient_name) as patient_name
      FROM sensor_data
      GROUP BY session_id
      ORDER BY start_time DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi tải lịch sử' });
  }
});

// API 2: Lấy chi tiết toàn bộ dữ liệu của 1 phiên cụ thể
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const sessionId = req.params.id;
    const query = `
      SELECT * FROM sensor_data 
      WHERE session_id = $1 
      ORDER BY time ASC
    `;
    const result = await pool.query(query, [sessionId]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Lỗi khi tải dữ liệu phiên' });
  }
});
