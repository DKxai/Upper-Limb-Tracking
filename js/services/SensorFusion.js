/**
 * SensorFusion - Complementary Filter for combining accelerometer & gyroscope data
 * Produces Roll, Pitch, Yaw (Euler angles) and computes joint angles.
 */

import { Orientation, JointAngles } from '../models/SensorData.js';
import { ArmSegment, FUSION_CONFIG } from '../utils/Constants.js';
import { MathUtils } from '../utils/MathUtils.js';

/**
 * Per-sensor fusion state
 */
class FusionState {
  constructor() {
    this.roll = 0;
    this.pitch = 0;
    this.yaw = 0;
    this.initialized = false;

    // Calibration
    this.gyroBias = { x: 0, y: 0, z: 0 };
    this.calibrationSamples = [];
    this.isCalibrated = false;

    // Orientation zero-reference offset (saved after calibration)
    this.offsetRoll = 0;
    this.offsetPitch = 0;
    this.offsetYaw = 0;
  }

  /**
   * Add calibration sample
   * @param {import('../models/SensorData.js').IMUReading} reading
   * @returns {boolean} True if calibration is complete
   */
  addCalibrationSample(reading) {
    this.calibrationSamples.push({ gx: reading.gx, gy: reading.gy, gz: reading.gz });

    if (this.calibrationSamples.length >= FUSION_CONFIG.CALIBRATION_SAMPLES) {
      // Calculate average bias
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
}

export class SensorFusion {
  constructor() {
    this.alpha = FUSION_CONFIG.COMPLEMENTARY_ALPHA;
    this.dt = 0.02; // 1/50Hz = 20ms

    /** @type {Object.<string, FusionState>} */
    this._states = {};
    for (const seg of Object.values(ArmSegment)) {
      this._states[seg] = new FusionState();
    }

    this._isCalibrating = false;
    this._calibrationProgress = 0;
  }

  /** @returns {boolean} Whether all sensors are calibrated */
  get isCalibrated() {
    return Object.values(this._states).every(s => s.isCalibrated);
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
    for (const state of Object.values(this._states)) {
      state.isCalibrated = false;
      state.calibrationSamples = [];
      state.initialized = false;
    }
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
      const state = this._states[segment];
      const reading = readings[segment];
      if (!state.isCalibrated) {
        state.addCalibrationSample(reading);
        totalProgress += state.calibrationSamples.length;
        if (!state.isCalibrated) allDone = false;
      } else {
        totalProgress += FUSION_CONFIG.CALIBRATION_SAMPLES;
      }
    }

    const maxTotal = FUSION_CONFIG.CALIBRATION_SAMPLES * numActiveSegments;
    this._calibrationProgress = Math.round((totalProgress / maxTotal) * 100);

    if (allDone) {
      this._isCalibrating = false;
      this._calibrationProgress = 100;

      // Save current orientation as zero-reference offset
      // This makes the current pose (standing, arms down) = 0°
      for (const segment of activeSegments) {
        const state = this._states[segment];
        const reading = readings[segment];
        if (reading) {
          // Quick compute accelerometer-based angles for the reference pose
          const refRoll = MathUtils.accelRoll(reading.ay, reading.az);
          const refPitch = MathUtils.accelPitch(reading.ax, reading.ay, reading.az);
          state.offsetRoll = refRoll;
          state.offsetPitch = refPitch;
          state.offsetYaw = 0; // Yaw drift is always relative, offset to 0
          // Also initialize the fusion state to these values
          state.roll = refRoll;
          state.pitch = refPitch;
          state.yaw = 0;
          state.initialized = true;
        }
      }
    }

    return allDone;
  }

  /**
   * Process a set of IMU readings through the complementary filter
   * @param {Object.<string, import('../models/SensorData.js').IMUReading>} readings
   * @returns {{ orientations: Object.<string, Orientation>, jointAngles: JointAngles }}
   */
  process(readings) {
    const orientations = {};

    for (const [segment, reading] of Object.entries(readings)) {
      const state = this._states[segment];
      if (!state || !reading) continue;

      // Remove gyro bias
      const gx = reading.gx - (state.isCalibrated ? state.gyroBias.x : 0);
      const gy = reading.gy - (state.isCalibrated ? state.gyroBias.y : 0);
      const gz = reading.gz - (state.isCalibrated ? state.gyroBias.z : 0);

      // Accelerometer-based angles
      const accelRoll = MathUtils.accelRoll(reading.ay, reading.az);
      const accelPitch = MathUtils.accelPitch(reading.ax, reading.ay, reading.az);

      if (!state.initialized) {
        // Initialize with accelerometer angles
        state.roll = accelRoll;
        state.pitch = accelPitch;
        state.yaw = 0;
        state.initialized = true;
      } else {
        // Complementary filter
        state.roll = this.alpha * (state.roll + gx * this.dt) + (1 - this.alpha) * accelRoll;
        state.pitch = this.alpha * (state.pitch + gy * this.dt) + (1 - this.alpha) * accelPitch;
        // Yaw can only be estimated from gyro (no magnetometer)
        state.yaw += gz * this.dt;

        // Normalize yaw to [-180, 180]
        if (state.yaw > 180) state.yaw -= 360;
        if (state.yaw < -180) state.yaw += 360;
      }

      orientations[segment] = new Orientation(
        MathUtils.roundTo(state.roll - state.offsetRoll, 2),
        MathUtils.roundTo(state.pitch - state.offsetPitch, 2),
        MathUtils.roundTo(state.yaw - state.offsetYaw, 2)
      );
    }

    // Compute joint angles from orientations
    const jointAngles = this._computeJointAngles(orientations);

    return { orientations, jointAngles };
  }

  /**
   * Compute joint angles from segment orientations
   * @param {Object.<string, Orientation>} orientations
   * @returns {JointAngles}
   * @private
   */
  _computeJointAngles(orientations) {
    const leftUpper = orientations[ArmSegment.LEFT_UPPER_ARM];
    const leftForearm = orientations[ArmSegment.LEFT_FOREARM];
    const leftWrist = orientations[ArmSegment.LEFT_WRIST];
    
    const rightUpper = orientations[ArmSegment.RIGHT_UPPER_ARM];
    const rightForearm = orientations[ArmSegment.RIGHT_FOREARM];
    const rightWrist = orientations[ArmSegment.RIGHT_WRIST];

    const angles = new JointAngles();

    // --- Tay Trái (Left Arm) ---
    if (leftUpper) {
      angles.leftShoulderFlexion = MathUtils.roundTo(Math.abs(leftUpper.pitch), 1);
      angles.leftShoulderAbduction = MathUtils.roundTo(Math.abs(leftUpper.roll), 1);
    }
    if (leftUpper && leftForearm) {
      angles.leftElbowFlexion = MathUtils.roundTo(Math.max(0, leftForearm.pitch - leftUpper.pitch), 1);
    }
    if (leftForearm && leftWrist) {
      angles.leftWristFlexion = MathUtils.roundTo(leftWrist.pitch - leftForearm.pitch, 1);
      angles.leftWristDeviation = MathUtils.roundTo(leftWrist.yaw - leftForearm.yaw, 1);
    }

    // --- Tay Phải (Right Arm) ---
    if (rightUpper) {
      angles.rightShoulderFlexion = MathUtils.roundTo(Math.abs(rightUpper.pitch), 1);
      angles.rightShoulderAbduction = MathUtils.roundTo(Math.abs(rightUpper.roll), 1);
    }
    if (rightUpper && rightForearm) {
      angles.rightElbowFlexion = MathUtils.roundTo(Math.max(0, rightForearm.pitch - rightUpper.pitch), 1);
    }
    if (rightForearm && rightWrist) {
      angles.rightWristFlexion = MathUtils.roundTo(rightWrist.pitch - rightForearm.pitch, 1);
      angles.rightWristDeviation = MathUtils.roundTo(rightWrist.yaw - rightForearm.yaw, 1);
    }

    return angles;
  }

  /**
   * Public method to compute joint angles from orientations
   * Used when ESP32 sends pre-fused orientation data (skipping fusion step)
   * @param {Object.<string, import('../models/SensorData.js').Orientation>} orientations
   * @returns {JointAngles}
   */
  computeJointAngles(orientations) {
    return this._computeJointAngles(orientations);
  }

  /**
   * Reset fusion state
   */
  reset() {
    for (const state of Object.values(this._states)) {
      state.roll = 0;
      state.pitch = 0;
      state.yaw = 0;
      state.initialized = false;
    }
  }

  /**
   * Set complementary filter alpha
   * @param {number} alpha - Value between 0.9 and 0.99
   */
  setAlpha(alpha) {
    this.alpha = MathUtils.clamp(alpha, 0.5, 0.999);
  }

  /**
   * Set sample rate (affects dt)
   * @param {number} hz
   */
  setSampleRate(hz) {
    this.dt = 1 / hz;
  }
}
