/**
 * SensorData Model
 * Represents a single data sample from all 3 MPU6050 sensors.
 * Immutable data structure.
 */

import { ArmSegment } from '../utils/Constants.js';

/**
 * Raw reading from a single MPU6050 sensor
 */
export class IMUReading {
  /**
   * @param {number} ax - Accelerometer X (g)
   * @param {number} ay - Accelerometer Y (g)
   * @param {number} az - Accelerometer Z (g)
   * @param {number} gx - Gyroscope X (°/s)
   * @param {number} gy - Gyroscope Y (°/s)
   * @param {number} gz - Gyroscope Z (°/s)
   */
  constructor(ax = 0, ay = 0, az = 0, gx = 0, gy = 0, gz = 0) {
    this.ax = ax;
    this.ay = ay;
    this.az = az;
    this.gx = gx;
    this.gy = gy;
    this.gz = gz;
    Object.freeze(this);
  }

  /** Acceleration magnitude */
  get accelMagnitude() {
    return Math.sqrt(this.ax ** 2 + this.ay ** 2 + this.az ** 2);
  }

  /** Gyroscope magnitude */
  get gyroMagnitude() {
    return Math.sqrt(this.gx ** 2 + this.gy ** 2 + this.gz ** 2);
  }
}

/**
 * Orientation data after sensor fusion (Roll, Pitch, Yaw)
 */
export class Orientation {
  /**
   * @param {number} roll  - degrees
   * @param {number} pitch - degrees
   * @param {number} yaw   - degrees
   */
  constructor(roll = 0, pitch = 0, yaw = 0) {
    this.roll = roll;
    this.pitch = pitch;
    this.yaw = yaw;
    Object.freeze(this);
  }
}

/**
 * Joint angle data (Dual-Arm)
 */
export class JointAngles {
  constructor() {
    this.leftShoulderFlexion = 0;
    this.leftShoulderAbduction = 0;
    this.leftElbowFlexion = 0;
    this.leftWristFlexion = 0;
    this.leftWristDeviation = 0;
    
    this.rightShoulderFlexion = 0;
    this.rightShoulderAbduction = 0;
    this.rightElbowFlexion = 0;
    this.rightWristFlexion = 0;
    this.rightWristDeviation = 0;
  }
}

/**
 * Complete sensor data sample containing raw + processed data for all segments
 */
export class SensorDataSample {
  /**
   * @param {number} timestamp - Milliseconds from start
   * @param {number} frameIndex - Frame number
   * @param {Object.<string, IMUReading>} raw - Raw IMU readings per segment
   * @param {Object.<string, Orientation>} orientation - Fused orientation per segment
   * @param {JointAngles} jointAngles - Computed joint angles
   */
  constructor(timestamp, frameIndex, raw = {}, orientation = {}, jointAngles = null, calibrated = {}) {
    this.timestamp = timestamp;
    this.frameIndex = frameIndex;
    // Dynamically create entries for ALL defined segments
    this.raw = {};
    this.calibrated = {};
    this.orientation = {};
    for (const seg of Object.values(ArmSegment)) {
      this.raw[seg] = raw[seg] || new IMUReading();
      this.calibrated[seg] = calibrated[seg] || new IMUReading();
      this.orientation[seg] = orientation[seg] || new Orientation();
    }
    this.jointAngles = jointAngles || new JointAngles();
  }
}
