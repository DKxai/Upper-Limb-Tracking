/**
 * SensorFusion - Madgwick 6DOF Filter for combining accelerometer & gyroscope data
 * Produces Roll, Pitch, Yaw (Euler angles) and computes joint angles.
 * 
 * Pipeline per sensor:
 *   Raw (g, °/s) → Calibration (m/s², °/s) → Madgwick (quaternion) → Euler angles
 */

import { Orientation, JointAngles, IMUReading } from '../models/SensorData.js';
import { ArmSegment, FUSION_CONFIG, SEGMENT_BY_INDEX, BONE_AXIS } from '../utils/Constants.js';
import { MathUtils } from '../utils/MathUtils.js';
import { Madgwick6DOF, DEG_TO_RAD } from './MadgwickFilter.js';
import { applyCalibration, LOCAL_G } from '../utils/CalibrationData.js';
import { Quaternion } from '../utils/Quaternion.js';

/**
 * Per-sensor fusion state
 */
class FusionState {
  constructor(sampleFreq, beta) {
    this.filter = new Madgwick6DOF(sampleFreq, beta);
    this.initialized = false;

    // Calibration
    this.gyroBias = { x: 0, y: 0, z: 0 };
    this.calibrationSamples = [];
    this.isCalibrated = false;

    // ZARU (Zero Angular Rate Update) — đếm số mẫu đứng yên liên tục
    this.zaruStillCount = 0;

    // Orientation gần nhất đã tính — giữ lại khi node vắng mặt 1 frame (TDMA rớt gói)
    // để góc khớp không sụp về 0 (fix sóng vuông wrist-deviation).
    this.lastOrientation = null;
    this.lastCorrQuat = null;     // q_corr gần nhất (giữ khi node vắng frame)

    // Orientation zero-reference offset (saved after calibration)
    this.offsetRoll = 0;
    this.offsetPitch = 0;
    this.offsetYaw = 0;
    this.offsetQuat = null;       // quaternion tư thế trung tính (tham chiếu 0)

    // Mốc thời gian (ms) để tính Δt thực cho Madgwick
    this.lastUpdateMs = null;

    // Node ID for calibration lookup (set externally)
    this.nodeId = null;

    // Cache the last read accelerometer values for use at the end of calibration
    this.lastAccel = { ax: 0, ay: 0, az: 1 };
  }

  /**
   * Add calibration sample — collects gyro bias at rest
   * @param {import('../models/SensorData.js').IMUReading} reading
   * @returns {boolean} True if calibration is complete
   */
  addCalibrationSample(reading) {
    this.calibrationSamples.push({ gx: reading.gx, gy: reading.gy, gz: reading.gz });
    this.lastAccel.ax = reading.ax;
    this.lastAccel.ay = reading.ay;
    this.lastAccel.az = reading.az;

    if (this.calibrationSamples.length >= FUSION_CONFIG.CALIBRATION_SAMPLES) {
      // Calculate average gyro bias
      const n = this.calibrationSamples.length;
      this.gyroBias.x = this.calibrationSamples.reduce((s, v) => s + v.gx, 0) / n;
      this.gyroBias.y = this.calibrationSamples.reduce((s, v) => s + v.gy, 0) / n;
      this.gyroBias.z = this.calibrationSamples.reduce((s, v) => s + v.gz, 0) / n;
      this.isCalibrated = true;
      this.calibrationSamples = []; // Free memory
      return true;
    }
    return false;
  }

  /**
   * Add orientation calibration sample
   * @param {import('../models/SensorData.js').Orientation} orientation
   * @returns {boolean} True if calibration is complete
   */
  addOrientationCalibrationSample(orientation) {
    this.calibrationSamples.push({
      roll: orientation.roll,
      pitch: orientation.pitch,
      yaw: orientation.yaw
    });

    if (this.calibrationSamples.length >= FUSION_CONFIG.CALIBRATION_SAMPLES) {
      const n = this.calibrationSamples.length;
      this.offsetRoll = this.calibrationSamples.reduce((s, v) => s + v.roll, 0) / n;
      this.offsetPitch = this.calibrationSamples.reduce((s, v) => s + v.pitch, 0) / n;
      this.offsetYaw = this.calibrationSamples.reduce((s, v) => s + v.yaw, 0) / n;
      this.isCalibrated = true;
      this.calibrationSamples = []; // Free memory
      return true;
    }
    return false;
  }
}

export class SensorFusion {
  constructor() {
    this.beta = FUSION_CONFIG.MADGWICK_BETA;
    this.sampleFreq = FUSION_CONFIG.MADGWICK_SAMPLE_HZ;

    /** @type {Object.<string, FusionState>} */
    this._states = {};
    for (const seg of Object.values(ArmSegment)) {
      this._states[seg] = new FusionState(this.sampleFreq, this.beta);
    }

    // Assign node IDs for calibration lookup
    // SEGMENT_BY_INDEX: [null, seg1, seg2, ..., seg6]
    for (let i = 1; i <= 6; i++) {
      const seg = SEGMENT_BY_INDEX[i];
      if (seg && this._states[seg]) {
        this._states[seg].nodeId = i;
      }
    }

    this._isCalibrating = false;
    this._calibrationProgress = 0;
    this.activeSegments = new Set();

    // Baseline for the wrist-deviation yaw high-pass (drift removal), per side.
    this._devBaseline = { left: 0, right: 0 };
  }

  /** @returns {boolean} Whether all active sensors are calibrated */
  get isCalibrated() {
    const active = Array.from(this.activeSegments);
    if (active.length === 0) {
      return Object.values(this._states).some(s => s.isCalibrated);
    }
    return active.every(seg => this._states[seg].isCalibrated);
  }

  /** @returns {boolean} */
  get isCalibrating() {
    return this._isCalibrating;
  }

  /** @returns {number} Calibration progress 0-100 */
  get calibrationProgress() {
    return this._calibrationProgress;
  }

  /**
   * Start calibration process
   * Sensors should be stationary during calibration
   */
  startCalibration() {
    this._isCalibrating = true;
    this._calibrationProgress = 0;
    this.activeSegments.clear();
    for (const state of Object.values(this._states)) {
      state.isCalibrated = false;
      state.calibrationSamples = [];
      state.initialized = false;
      state.filter.reset();
      state.offsetQuat = null;
      state.lastCorrQuat = null;
      state.lastOrientation = null;
      state.lastUpdateMs = null;
      state.zaruStillCount = 0;
    }
    this._devBaseline = { left: 0, right: 0 };
  }

  /**
   * Apply per-node lab calibration to a raw reading → calibrated IMUReading
   * (accel m/s², gyro °/s). @private
   */
  _calibrate(state, reading) {
    const nodeId = state.nodeId || 1;
    const c = applyCalibration(
      nodeId,
      reading.ax, reading.ay, reading.az,
      reading.gx, reading.gy, reading.gz
    );
    return new IMUReading(c.ax, c.ay, c.az, c.gx, c.gy, c.gz);
  }

  /**
   * Process calibration data
   * @param {Object.<string, import('../models/SensorData.js').IMUReading>} readings
   * @returns {boolean} True if calibration is complete
   */
  processCalibration(readings) {
    let totalProgress = 0;
    let allDone = true;
    const activeSegments = Object.keys(readings).filter(seg => this._states[seg] && readings[seg]);
    const numActiveSegments = Math.max(activeSegments.length, 1);

    for (const segment of activeSegments) {
      this.activeSegments.add(segment);
      const state = this._states[segment];
      const reading = readings[segment];
      if (!state.isCalibrated) {
        // Capture the at-rest gyro bias in the SAME calibrated (°/s) domain it is
        // later subtracted in. Averaging RAW gyro here (the old behaviour) and
        // subtracting it from the lab-calibrated runtime value double-removed the
        // bias with a scale mismatch → a phantom rate at rest → drift.
        const cal = this._calibrate(state, reading);
        const done = state.addCalibrationSample(cal);
        if (done) {
          totalProgress += FUSION_CONFIG.CALIBRATION_SAMPLES;
        } else {
          totalProgress += state.calibrationSamples.length;
          allDone = false;
        }
      } else {
        totalProgress += FUSION_CONFIG.CALIBRATION_SAMPLES;
      }
    }

    const maxTotal = FUSION_CONFIG.CALIBRATION_SAMPLES * numActiveSegments;
    this._calibrationProgress = Math.round((totalProgress / maxTotal) * 100);

    if (allDone) {
      this._isCalibrating = false;
      this._calibrationProgress = 100;

      // Capture the neutral pose as a quaternion reference and SEED the filter to
      // it, so orientation + joint angles read ~0 at neutral with no startup swoop
      // and the filter starts already converged.
      for (const segment of activeSegments) {
        const state = this._states[segment];
        const reading = readings[segment];
        
        let ax, ay, az;
        if (reading) {
          const cal = this._calibrate(state, reading);
          ax = cal.ax;
          ay = cal.ay;
          az = cal.az;
        } else {
          ax = state.lastAccel.ax;
          ay = state.lastAccel.ay;
          az = state.lastAccel.az;
        }

        const refRoll = MathUtils.accelRoll(ay, az);
        const refPitch = MathUtils.accelPitch(ax, ay, az);
        state.offsetRoll = refRoll;
        state.offsetPitch = refPitch;
        state.offsetYaw = 0; // yaw is relative (no magnetometer) → reference is 0
        state.offsetQuat = Quaternion.fromEulerDeg(refRoll, refPitch, 0);
        state.filter.setQuaternion(
          state.offsetQuat[0], state.offsetQuat[1], state.offsetQuat[2], state.offsetQuat[3]
        );
        state.initialized = true;
        state.lastUpdateMs = null;
        state.lastCorrQuat = null;
      }
      this._devBaseline = { left: 0, right: 0 };
    }

    return allDone;
  }

  /**
   * Process orientation calibration data
   * @param {Object.<string, import('../models/SensorData.js').Orientation>} orientations
   * @returns {boolean} True if calibration is complete
   */
  processOrientationCalibration(orientations) {
    let totalProgress = 0;
    let allDone = true;
    const activeSegments = Object.keys(orientations).filter(seg => this._states[seg] && orientations[seg]);
    const numActiveSegments = Math.max(activeSegments.length, 1);

    for (const segment of activeSegments) {
      this.activeSegments.add(segment);
      const state = this._states[segment];
      const orientation = orientations[segment];
      if (!state.isCalibrated) {
        const done = state.addOrientationCalibrationSample(orientation);
        if (done) {
          totalProgress += FUSION_CONFIG.CALIBRATION_SAMPLES;
        } else {
          totalProgress += state.calibrationSamples.length;
          allDone = false;
        }
      } else {
        totalProgress += FUSION_CONFIG.CALIBRATION_SAMPLES;
      }
    }

    const maxTotal = FUSION_CONFIG.CALIBRATION_SAMPLES * numActiveSegments;
    this._calibrationProgress = Math.round((totalProgress / maxTotal) * 100);

    if (allDone) {
      this._isCalibrating = false;
      this._calibrationProgress = 100;
    }

    return allDone;
  }

  /**
   * Process a set of IMU readings through the Madgwick filter pipeline
   * 
   * Pipeline: Raw (g, °/s) → Calibration (m/s², °/s) → Madgwick → Euler
   * 
   * @param {Object.<string, import('../models/SensorData.js').IMUReading>} readings
   * @returns {{ orientations: Object.<string, Orientation>, jointAngles: JointAngles }}
   */
  process(readings, timestampMs) {
    const orientations = {};
    const calibrated = {};
    const corrQuats = {};

    for (const [segment, reading] of Object.entries(readings)) {
      const state = this._states[segment];
      if (!state || !reading) continue;

      this.activeSegments.add(segment);

      // 1. Apply per-node calibration (raw g/°/s → calibrated m/s²/°/s)
      const cal = this._calibrate(state, reading);
      calibrated[segment] = cal;

      // 1b. ZARU — bù trôi bias gyro khi cảm biến đứng yên (Zero Angular Rate Update)
      if (FUSION_CONFIG.ZARU_ENABLED && state.isCalibrated) {
        this._applyZARU(state, cal);
      }

      // 2. Remove gyro bias (now consistently in the calibrated °/s domain)
      const gx_dps = cal.gx - (state.isCalibrated ? state.gyroBias.x : 0);
      const gy_dps = cal.gy - (state.isCalibrated ? state.gyroBias.y : 0);
      const gz_dps = cal.gz - (state.isCalibrated ? state.gyroBias.z : 0);

      // 3. Convert gyro °/s → rad/s (Madgwick expects rad/s)
      const gx_rad = gx_dps * DEG_TO_RAD;
      const gy_rad = gy_dps * DEG_TO_RAD;
      const gz_rad = gz_dps * DEG_TO_RAD;

      // 4. Measured Δt for THIS node from the frame timestamp (master millis).
      //    Falls back to nominal on the first sample; clamped so a dropped frame
      //    / TDMA gap can't produce a giant integration step.
      let dt = 1 / this.sampleFreq;
      if (Number.isFinite(timestampMs) && state.lastUpdateMs != null) {
        const d = (timestampMs - state.lastUpdateMs) / 1000;
        if (d > 0) dt = MathUtils.clamp(d, FUSION_CONFIG.DT_MIN_S, FUSION_CONFIG.DT_MAX_S);
      }
      if (Number.isFinite(timestampMs)) state.lastUpdateMs = timestampMs;

      // 5. Feed Madgwick filter with the measured Δt (accel normalized internally)
      state.filter.updateIMU(gx_rad, gy_rad, gz_rad, cal.ax, cal.ay, cal.az, dt);
      state.initialized = true;

      // 6. Orientation relative to the calibrated neutral: q_corr = offset⁻¹ ⊗ q.
      //    Doing this in quaternion space (not by subtracting Euler angles) keeps
      //    it correct away from neutral and through gimbal-lock regions.
      const qf = state.filter.getQuaternion();
      const qc = state.offsetQuat
        ? Quaternion.normalize(Quaternion.multiply(Quaternion.conjugate(state.offsetQuat), qf))
        : Quaternion.normalize(qf);
      corrQuats[segment] = qc;
      state.lastCorrQuat = qc;       // giữ khi frame sau thiếu node

      // 7. Euler output for the RPY charts + 3D pose
      const e = Quaternion.toEulerDeg(qc);
      orientations[segment] = new Orientation(
        MathUtils.roundTo(e.roll, 2),
        MathUtils.roundTo(e.pitch, 2),
        MathUtils.roundTo(e.yaw, 2)
      );
      state.lastOrientation = orientations[segment];
    }

    // Giữ giá trị gần nhất cho các segment đã từng hoạt động nhưng vắng mặt frame này
    // (TDMA: 1 frame BLE không phải lúc nào cũng đủ cả 3-6 node). Nếu bỏ qua, các góc
    // khớp phụ thuộc segment đó sẽ về 0 mặc định → nhảy 0↔giá-trị (sóng vuông).
    for (const segment of this.activeSegments) {
      if (!corrQuats[segment]) {
        const state = this._states[segment];
        if (state && state.lastCorrQuat) {
          corrQuats[segment] = state.lastCorrQuat;
          if (!orientations[segment] && state.lastOrientation) orientations[segment] = state.lastOrientation;
        }
      }
    }

    // Compute joint angles from the per-segment (neutral-relative) quaternions
    const jointAngles = this._computeJointAnglesFromQuats(corrQuats);

    return { orientations, jointAngles, calibrated, quaternions: corrQuats };
  }

  /**
   * ZARU — Zero Angular Rate Update.
   * Khi cảm biến đứng yên (|ω| nhỏ và ‖a‖ ≈ g), vận tốc góc thật bằng 0,
   * nên gyro đã hiệu chuẩn (cal.gx/gy/gz) chính là bias hiện thời. Cập nhật
   * chậm state.gyroBias bằng low-pass để bù trôi nhiệt/thời gian — bias
   * dạng offline chỉ đúng tại thời điểm calib, ZARU giữ nó luôn tươi lúc chạy.
   *
   * @param {FusionState} state
   * @param {{ax:number,ay:number,az:number,gx:number,gy:number,gz:number}} cal  m/s² và °/s đã hiệu chuẩn
   * @private
   */
  _applyZARU(state, cal) {
    // Vận tốc góc đã bù bias hiện tại (°/s)
    const wx = cal.gx - state.gyroBias.x;
    const wy = cal.gy - state.gyroBias.y;
    const wz = cal.gz - state.gyroBias.z;
    const gyroMag = Math.sqrt(wx * wx + wy * wy + wz * wz);

    // Độ lớn gia tốc (m/s²) — đứng yên thì phải xấp xỉ trọng trường g
    const accMag = Math.sqrt(cal.ax * cal.ax + cal.ay * cal.ay + cal.az * cal.az);
    const accStill = Math.abs(accMag - LOCAL_G) < FUSION_CONFIG.ZARU_ACCEL_TOL_MS2;
    const gyroStill = gyroMag < FUSION_CONFIG.ZARU_GYRO_THRESH_DPS;

    if (gyroStill && accStill) {
      state.zaruStillCount++;
      if (state.zaruStillCount >= FUSION_CONFIG.ZARU_MIN_SAMPLES) {
        // Khi đứng yên: bias đúng = gyro hiệu chuẩn. Bám chậm để khỏi nhiễu.
        const a = FUSION_CONFIG.ZARU_ALPHA;
        state.gyroBias.x += a * (cal.gx - state.gyroBias.x);
        state.gyroBias.y += a * (cal.gy - state.gyroBias.y);
        state.gyroBias.z += a * (cal.gz - state.gyroBias.z);
      }
    } else {
      state.zaruStillCount = 0;
    }
  }

  /**
   * Compute joint angles from per-segment (neutral-relative) quaternions.
   *
   * ĐÃ SỬA các lỗi quan trọng:
   *
   * FIX 1 — Elbow flexion dùng angleBetweenDeg(vU, vF) thay vì Euler pitch.
   *   Euler pitch = asin(...) BÃO HÒA ở ±90° → khuỷu gập 120° hiển thị 60°.
   *   angleBetween dùng acos(dot) → phạm vi 0–180°, đúng mọi góc.
   *
   * FIX 2 — Shoulder Total Elevation + Plane of Elevation.
   *   Đo chuyển động chéo (scaption) chính xác.
   *
   * FIX 3 — Wrist: swing–twist tách pro/sup khỏi flexion/deviation.
   *
   * FIX 4 — Pronation/Supination = twist(q_rel(upper→forearm)).
   *
   * FIX 5 — Shoulder Int/Ext Rotation = twist(q_upper_arm).
   *
   * FIX 6 — Shoulder flexion giữ dấu (bỏ Math.abs), phân biệt
   *   flexion (+) vs extension (−).
   *
   * @param {Object.<string, number[]>} q - segment → quaternion [w,x,y,z]
   * @returns {JointAngles}
   * @private
   */
  _computeJointAnglesFromQuats(q) {
    const lu = q[ArmSegment.LEFT_UPPER_ARM], lf = q[ArmSegment.LEFT_FOREARM], lw = q[ArmSegment.LEFT_WRIST];
    const ru = q[ArmSegment.RIGHT_UPPER_ARM], rf = q[ArmSegment.RIGHT_FOREARM], rw = q[ArmSegment.RIGHT_WRIST];

    const angles = new JointAngles();
    const r1 = (x) => MathUtils.roundTo(x, 1);
    const rel = (parent, child) => Quaternion.multiply(Quaternion.conjugate(parent), child);
    const R2D = 180 / Math.PI;

    // --- Tay Trái (Left Arm) ---
    if (lu) {
      // FIX 2 — Shoulder: hướng cánh tay trong không gian 3D
      const vArm = Quaternion.rotateVector(lu, BONE_AXIS);
      const elev = Quaternion.angleBetweenDeg(vArm, BONE_AXIS);
      const planeRad = Math.atan2(vArm[1], vArm[2]);
      angles.leftShoulderElevation = r1(elev);
      angles.leftShoulderPlane = r1(planeRad * R2D);
      // FIX 7 — Flexion/Abduction = phân rã hình học (elevation, plane), KHÔNG
      // dùng Euler pitch/roll của swing. Đường Euler cũ hỏng khi dùng thật:
      //  (a) pitch NGƯỢC DẤU (gập 60° đọc −60° → model 3D quay ra sau);
      //  (b) asin bão hòa ±90°: gập 120° đọc −60° + roll nhảy 180° → model
      //      lộn/bẻ tay ngay khi tay vượt ngang vai;
      //  (c) dạng vai thuần đọc ≈ 0 vì roll của swing (đã tách twist) luôn ≈ 0.
      // Phân rã: flexion = elev·cos(plane), abduction = elev·sin(plane) —
      // liên tục 0–180°, giữ dấu (plane ngoài ±90° ⇒ thành phần duỗi/khép âm).
      // (Đã kiểm chứng bằng test quaternion tổng hợp: flex 60/120, abd 90,
      //  ext −30, scaption 45° — xem test_joint_angles.mjs.)
      angles.leftShoulderFlexion = r1(elev * Math.cos(planeRad));
      angles.leftShoulderAbduction = r1(elev * Math.sin(planeRad));
      // FIX 5 — Int/Ext Rotation
      const { angleDeg: intExtRot } = Quaternion.swingTwist(lu, BONE_AXIS);
      angles.leftShoulderRotation = r1(intExtRot);
    }
    if (lu && lf) {
      // FIX 1 — Elbow: angle-between bone axes (0–180°, KHÔNG bão hòa ±90°)
      const vU = Quaternion.rotateVector(lu, BONE_AXIS);
      const vF = Quaternion.rotateVector(lf, BONE_AXIS);
      angles.leftElbowFlexion = r1(Quaternion.angleBetweenDeg(vU, vF));
      // FIX 4 — Pronation/Supination
      const { angleDeg: proSup } = Quaternion.swingTwist(rel(lu, lf), BONE_AXIS);
      angles.leftForearmProSup = r1(proSup);
    }
    if (lf && lw) {
      // FIX 3 — Wrist: swing–twist tách xoay cẳng tay khỏi flex/dev
      const qRel = rel(lf, lw);
      const { swing } = Quaternion.swingTwist(qRel, BONE_AXIS);
      const e = Quaternion.toEulerDeg(swing);
      angles.leftWristFlexion = r1(e.pitch);
      angles.leftWristDeviation = r1(this._leakDeviation('left', e.yaw));
    }

    // --- Tay Phải (Right Arm) ---
    if (ru) {
      // FIX 7 — như tay trái: phân rã (elevation, plane), không dùng Euler swing
      const vArm = Quaternion.rotateVector(ru, BONE_AXIS);
      const elev = Quaternion.angleBetweenDeg(vArm, BONE_AXIS);
      const planeRad = Math.atan2(vArm[1], vArm[2]);
      angles.rightShoulderElevation = r1(elev);
      angles.rightShoulderPlane = r1(planeRad * R2D);
      angles.rightShoulderFlexion = r1(elev * Math.cos(planeRad));
      angles.rightShoulderAbduction = r1(elev * Math.sin(planeRad));
      const { angleDeg: intExtRot } = Quaternion.swingTwist(ru, BONE_AXIS);
      angles.rightShoulderRotation = r1(intExtRot);
    }
    if (ru && rf) {
      const vU = Quaternion.rotateVector(ru, BONE_AXIS);
      const vF = Quaternion.rotateVector(rf, BONE_AXIS);
      angles.rightElbowFlexion = r1(Quaternion.angleBetweenDeg(vU, vF));
      const { angleDeg: proSup } = Quaternion.swingTwist(rel(ru, rf), BONE_AXIS);
      angles.rightForearmProSup = r1(proSup);
    }
    if (rf && rw) {
      const qRel = rel(rf, rw);
      const { swing } = Quaternion.swingTwist(qRel, BONE_AXIS);
      const e = Quaternion.toEulerDeg(swing);
      angles.rightWristFlexion = r1(e.pitch);
      angles.rightWristDeviation = r1(this._leakDeviation('right', e.yaw));
    }

    return angles;
  }

  /**
   * High-pass (leaky DC removal) for wrist deviation. Deviation comes from yaw,
   * which has no absolute reference on a 6-DOF IMU and slowly drifts; this pulls a
   * baseline toward the signal with a long time constant so slow drift is removed
   * while real (seconds-long) deviations pass through. @private
   */
  _leakDeviation(side, rawDev) {
    const k = FUSION_CONFIG.YAW_DRIFT_LEAK;
    if (!k) return rawDev;
    const b = this._devBaseline[side] || 0;
    this._devBaseline[side] = b + k * (rawDev - b);
    return rawDev - this._devBaseline[side];
  }

  /**
   * Public method to compute joint angles from orientations.
   * Used when ESP32 sends pre-fused orientation data (skipping the fusion step);
   * those Euler angles are converted to quaternions and run through the same
   * relative-quaternion solver.
   * @param {Object.<string, import('../models/SensorData.js').Orientation>} orientations
   * @returns {JointAngles}
   */
  computeJointAngles(orientations) {
    const q = {};
    for (const [seg, o] of Object.entries(orientations)) {
      if (o) q[seg] = Quaternion.fromEulerDeg(o.roll, o.pitch, o.yaw);
    }
    const jointAngles = this._computeJointAnglesFromQuats(q);
    return { jointAngles, quaternions: q };
  }

  /**
   * Reset fusion state
   */
  reset() {
    for (const state of Object.values(this._states)) {
      state.filter.reset();
      state.initialized = false;
      state.lastOrientation = null;
      state.lastCorrQuat = null;
      state.offsetQuat = null;
      state.lastUpdateMs = null;
      state.zaruStillCount = 0;
    }
    this._devBaseline = { left: 0, right: 0 };
  }

  /**
   * Set Madgwick filter beta gain
   * Higher beta = faster convergence but more accelerometer noise
   * Lower beta = smoother but slower to correct gyro drift
   * @param {number} beta - Value between 0.01 and 0.5
   */
  setBeta(beta) {
    this.beta = MathUtils.clamp(beta, 0.01, 0.5);
    for (const state of Object.values(this._states)) {
      state.filter.beta = this.beta;
    }
  }

  /**
   * Set sample rate (affects Madgwick dt)
   * @param {number} hz
   */
  setSampleRate(hz) {
    this.sampleFreq = hz;
    for (const state of Object.values(this._states)) {
      state.filter.sampleFreq = hz;
    }
  }
}
