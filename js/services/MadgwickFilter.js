/**
 * Madgwick 6DOF AHRS Filter (JavaScript port)
 * 
 * Based on Sebastian Madgwick's paper:
 * "An efficient orientation filter for inertial and inertial/magnetic sensor arrays"
 * 
 * Fuses accelerometer + gyroscope data using gradient descent optimization.
 * Outputs quaternion orientation, convertible to Euler angles.
 * 
 * Convention: ZYX (Yaw-Pitch-Roll), right-hand coordinate system.
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export class Madgwick6DOF {
  /**
   * @param {number} sampleFreq - Expected update rate in Hz
   * @param {number} beta - Filter gain (0.01 = slow convergence, 0.5 = fast but noisy)
   */
  constructor(sampleFreq = 50, beta = 0.1) {
    this.sampleFreq = sampleFreq;
    this.beta = beta;

    // Quaternion (initially identity = no rotation)
    this.q0 = 1.0;
    this.q1 = 0.0;
    this.q2 = 0.0;
    this.q3 = 0.0;
  }

  /**
   * Reset quaternion to identity
   */
  reset() {
    this.q0 = 1.0;
    this.q1 = 0.0;
    this.q2 = 0.0;
    this.q3 = 0.0;
  }

  /**
   * Seed the quaternion (e.g. to the calibrated neutral pose) so the filter
   * starts already converged instead of from identity. Normalizes the input.
   * @param {number} w @param {number} x @param {number} y @param {number} z
   */
  setQuaternion(w, x, y, z) {
    const n = Math.hypot(w, x, y, z) || 1;
    this.q0 = w / n;
    this.q1 = x / n;
    this.q2 = y / n;
    this.q3 = z / n;
  }

  /**
   * Update filter with new IMU data
   *
   * @param {number} gx - Gyroscope X in rad/s
   * @param {number} gy - Gyroscope Y in rad/s
   * @param {number} gz - Gyroscope Z in rad/s
   * @param {number} ax - Accelerometer X (any unit, will be normalized)
   * @param {number} ay - Accelerometer Y
   * @param {number} az - Accelerometer Z
   * @param {number} [dt] - Actual elapsed time since this filter's last update,
   *   in seconds. When omitted/invalid, falls back to the nominal 1/sampleFreq.
   *   Passing the measured Δt keeps integration correct when the real frame rate
   *   differs from the nominal rate or when a node is sampled irregularly (TDMA).
   */
  updateIMU(gx, gy, gz, ax, ay, az, dt) {
    let { q0, q1, q2, q3 } = this;

    // Quaternion derivative from gyroscope
    let qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
    let qDot2 = 0.5 * ( q0 * gx + q2 * gz - q3 * gy);
    let qDot3 = 0.5 * ( q0 * gy - q1 * gz + q3 * gx);
    let qDot4 = 0.5 * ( q0 * gz + q1 * gy - q2 * gx);

    // Only apply gradient descent correction if accel is valid (non-zero)
    if (!(ax === 0.0 && ay === 0.0 && az === 0.0)) {
      // Normalize accelerometer
      let recipNorm = 1.0 / Math.sqrt(ax * ax + ay * ay + az * az);
      ax *= recipNorm;
      ay *= recipNorm;
      az *= recipNorm;

      // Auxiliary variables
      const _2q0 = 2.0 * q0, _2q1 = 2.0 * q1;
      const _2q2 = 2.0 * q2, _2q3 = 2.0 * q3;
      const _4q0 = 4.0 * q0, _4q1 = 4.0 * q1, _4q2 = 4.0 * q2;
      const _8q1 = 8.0 * q1, _8q2 = 8.0 * q2;
      const q0q0 = q0 * q0, q1q1 = q1 * q1;
      const q2q2 = q2 * q2, q3q3 = q3 * q3;

      // Gradient descent corrective step
      let s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
      let s1 = _4q1 * q3q3 - _2q3 * ax + 4.0 * q0q0 * q1 - _2q0 * ay
               - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
      let s2 = 4.0 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay
               - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
      let s3 = 4.0 * q1q1 * q3 - _2q1 * ax + 4.0 * q2q2 * q3 - _2q2 * ay;

      // Normalize gradient step
      recipNorm = 1.0 / Math.sqrt(s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3);
      s0 *= recipNorm;
      s1 *= recipNorm;
      s2 *= recipNorm;
      s3 *= recipNorm;

      // Apply feedback
      qDot1 -= this.beta * s0;
      qDot2 -= this.beta * s1;
      qDot3 -= this.beta * s2;
      qDot4 -= this.beta * s3;
    }

    // Integrate rate of change over the actual elapsed time (fallback: nominal)
    const step = (Number.isFinite(dt) && dt > 0) ? dt : (1.0 / this.sampleFreq);
    q0 += qDot1 * step;
    q1 += qDot2 * step;
    q2 += qDot3 * step;
    q3 += qDot4 * step;

    // Normalize quaternion
    const recipNorm = 1.0 / Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
    this.q0 = q0 * recipNorm;
    this.q1 = q1 * recipNorm;
    this.q2 = q2 * recipNorm;
    this.q3 = q3 * recipNorm;
  }

  /**
   * Get Euler angles in degrees (ZYX convention: Yaw-Pitch-Roll)
   * @returns {{ roll: number, pitch: number, yaw: number }}
   */
  getEulerDeg() {
    const { q0, q1, q2, q3 } = this;
    const roll  = Math.atan2(2.0 * (q0 * q1 + q2 * q3), 1.0 - 2.0 * (q1 * q1 + q2 * q2)) * RAD_TO_DEG;
    const pitch = Math.asin(Math.max(-1, Math.min(1, 2.0 * (q0 * q2 - q3 * q1)))) * RAD_TO_DEG;
    const yaw   = Math.atan2(2.0 * (q0 * q3 + q1 * q2), 1.0 - 2.0 * (q2 * q2 + q3 * q3)) * RAD_TO_DEG;
    return { roll, pitch, yaw };
  }

  /**
   * Get quaternion as array [w, x, y, z]
   * @returns {number[]}
   */
  getQuaternion() {
    return [this.q0, this.q1, this.q2, this.q3];
  }
}

export { DEG_TO_RAD, RAD_TO_DEG };
