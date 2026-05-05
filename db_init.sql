-- Kích hoạt TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Xóa bảng cũ do thay đổi cấu trúc hoàn toàn từ 1 tay thành 2 tay
DROP TABLE IF EXISTS sensor_data CASCADE;

-- Tạo bảng chứa dữ liệu cảm biến
CREATE TABLE IF NOT EXISTS sensor_data (
    time TIMESTAMPTZ NOT NULL,
    session_id UUID NOT NULL,
    frame_index INTEGER,
    active_mask SMALLINT,
    
    -- Node 1: Left Upper Arm
    n1_ax REAL, n1_ay REAL, n1_az REAL, n1_gx REAL, n1_gy REAL, n1_gz REAL,
    -- Node 2: Left Forearm
    n2_ax REAL, n2_ay REAL, n2_az REAL, n2_gx REAL, n2_gy REAL, n2_gz REAL,
    -- Node 3: Left Wrist
    n3_ax REAL, n3_ay REAL, n3_az REAL, n3_gx REAL, n3_gy REAL, n3_gz REAL,
    -- Node 4: Right Upper Arm
    n4_ax REAL, n4_ay REAL, n4_az REAL, n4_gx REAL, n4_gy REAL, n4_gz REAL,
    -- Node 5: Right Forearm
    n5_ax REAL, n5_ay REAL, n5_az REAL, n5_gx REAL, n5_gy REAL, n5_gz REAL,
    -- Node 6: Right Wrist
    n6_ax REAL, n6_ay REAL, n6_az REAL, n6_gx REAL, n6_gy REAL, n6_gz REAL,

    -- Dữ liệu góc Tay Trái
    left_shoulder_flexion REAL,
    left_shoulder_abduction REAL,
    left_elbow_flexion REAL,
    left_wrist_flexion REAL,
    left_wrist_deviation REAL,

    -- Dữ liệu góc Tay Phải
    right_shoulder_flexion REAL,
    right_shoulder_abduction REAL,
    right_elbow_flexion REAL,
    right_wrist_flexion REAL,
    right_wrist_deviation REAL,

    -- Thông tin bệnh nhân
    patient_name TEXT
);

-- Chuyển bảng thường thành Hypertable của TimescaleDB để tối ưu hóa truy vấn Time-series
SELECT create_hypertable('sensor_data', 'time', if_not_exists => TRUE);

-- Tạo Index trên session_id để query nhanh theo từng bài tập
CREATE INDEX IF NOT EXISTS ix_sensor_data_session_id ON sensor_data (session_id, time DESC);
