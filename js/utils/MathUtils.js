/**
 * MathUtils - Mathematical helper functions for sensor data processing
 */

export const MathUtils = {
  /**
   * Convert degrees to radians
   * @param {number} deg
   * @returns {number}
   */
  degToRad(deg) {
    return deg * (Math.PI / 180);
  },

  /**
   * Convert radians to degrees
   * @param {number} rad
   * @returns {number}
   */
  radToDeg(rad) {
    return rad * (180 / Math.PI);
  },

  /**
   * Clamp a value between min and max
   * @param {number} val
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  },

  /**
   * Linear interpolation
   * @param {number} a - Start value
   * @param {number} b - End value
   * @param {number} t - Interpolation factor (0-1)
   * @returns {number}
   */
  lerp(a, b, t) {
    return a + (b - a) * t;
  },

  /**
   * Map a value from one range to another
   * @param {number} value
   * @param {number} inMin
   * @param {number} inMax
   * @param {number} outMin
   * @param {number} outMax
   * @returns {number}
   */
  mapRange(value, inMin, inMax, outMin, outMax) {
    return outMin + ((value - inMin) * (outMax - outMin)) / (inMax - inMin);
  },

  /**
   * Calculate magnitude of a 3D vector
   * @param {number} x
   * @param {number} y
   * @param {number} z
   * @returns {number}
   */
  magnitude(x, y, z) {
    return Math.sqrt(x * x + y * y + z * z);
  },

  /**
   * Dot product of two 3D vectors
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @returns {number}
   */
  dot(a, b) {
    return a.x * b.x + a.y * b.y + a.z * b.z;
  },

  /**
   * Cross product of two 3D vectors
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @returns {{x:number,y:number,z:number}}
   */
  cross(a, b) {
    return {
      x: a.y * b.z - a.z * b.y,
      y: a.z * b.x - a.x * b.z,
      z: a.x * b.y - a.y * b.x,
    };
  },

  /**
   * Normalize a 3D vector
   * @param {{x:number,y:number,z:number}} v
   * @returns {{x:number,y:number,z:number}}
   */
  normalize(v) {
    const mag = this.magnitude(v.x, v.y, v.z);
    if (mag === 0) return { x: 0, y: 0, z: 0 };
    return { x: v.x / mag, y: v.y / mag, z: v.z / mag };
  },

  /**
   * Angle between two 3D vectors (in degrees)
   * @param {{x:number,y:number,z:number}} a
   * @param {{x:number,y:number,z:number}} b
   * @returns {number} Angle in degrees
   */
  angleBetween(a, b) {
    const magA = this.magnitude(a.x, a.y, a.z);
    const magB = this.magnitude(b.x, b.y, b.z);
    if (magA === 0 || magB === 0) return 0;

    const cosAngle = this.clamp(this.dot(a, b) / (magA * magB), -1, 1);
    return this.radToDeg(Math.acos(cosAngle));
  },

  /**
   * Calculate Roll angle from accelerometer data
   * @param {number} ay - Accel Y (g)
   * @param {number} az - Accel Z (g)
   * @returns {number} Roll in degrees
   */
  accelRoll(ay, az) {
    return this.radToDeg(Math.atan2(ay, az));
  },

  /**
   * Calculate Pitch angle from accelerometer data
   * @param {number} ax - Accel X (g)
   * @param {number} ay - Accel Y (g)
   * @param {number} az - Accel Z (g)
   * @returns {number} Pitch in degrees
   */
  accelPitch(ax, ay, az) {
    return this.radToDeg(Math.atan2(-ax, Math.sqrt(ay * ay + az * az)));
  },

  /**
   * Calculate moving average
   * @param {number[]} data
   * @param {number} windowSize
   * @returns {number[]}
   */
  movingAverage(data, windowSize) {
    const result = [];
    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - windowSize + 1);
      const window = data.slice(start, i + 1);
      const avg = window.reduce((s, v) => s + v, 0) / window.length;
      result.push(avg);
    }
    return result;
  },

  /**
   * Calculate standard deviation
   * @param {number[]} data
   * @returns {number}
   */
  stdDev(data) {
    if (data.length === 0) return 0;
    const mean = data.reduce((s, v) => s + v, 0) / data.length;
    const variance = data.reduce((s, v) => s + (v - mean) ** 2, 0) / data.length;
    return Math.sqrt(variance);
  },

  /**
   * Calculate RMS (Root Mean Square)
   * @param {number[]} data
   * @returns {number}
   */
  rms(data) {
    if (data.length === 0) return 0;
    const sumSq = data.reduce((s, v) => s + v * v, 0);
    return Math.sqrt(sumSq / data.length);
  },

  /**
   * Simple numerical derivative
   * @param {number[]} data
   * @param {number} dt - Time step
   * @returns {number[]}
   */
  derivative(data, dt) {
    const result = [0];
    for (let i = 1; i < data.length; i++) {
      result.push((data[i] - data[i - 1]) / dt);
    }
    return result;
  },

  /**
   * Simple numerical integral (trapezoidal)
   * @param {number[]} data
   * @param {number} dt
   * @returns {number[]}
   */
  integrate(data, dt) {
    const result = [0];
    let sum = 0;
    for (let i = 1; i < data.length; i++) {
      sum += ((data[i] + data[i - 1]) / 2) * dt;
      result.push(sum);
    }
    return result;
  },

  /**
   * Round to N decimal places
   * @param {number} value
   * @param {number} decimals
   * @returns {number}
   */
  roundTo(value, decimals = 2) {
    const factor = Math.pow(10, decimals);
    return Math.round(value * factor) / factor;
  },
};
