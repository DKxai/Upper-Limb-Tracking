/**
 * Quaternion - minimal quaternion helpers for orientation math.
 *
 * Quaternions are stored as [w, x, y, z] arrays. The Euler convention matches
 * Madgwick6DOF.getEulerDeg() exactly — ZYX Tait–Bryan (yaw about Z, pitch about
 * Y, roll about X) — so fromEulerDeg/toEulerDeg round-trip with the filter and
 * with each other. Used for relative (parent⁻¹·child) joint-angle computation,
 * which composes rotations correctly instead of subtracting Euler angles.
 */

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const Quaternion = {
  /** Euler (degrees, ZYX) → quaternion [w,x,y,z]. */
  fromEulerDeg(roll, pitch, yaw) {
    const cr = Math.cos(roll * D2R / 2), sr = Math.sin(roll * D2R / 2);
    const cp = Math.cos(pitch * D2R / 2), sp = Math.sin(pitch * D2R / 2);
    const cy = Math.cos(yaw * D2R / 2), sy = Math.sin(yaw * D2R / 2);
    return [
      cr * cp * cy + sr * sp * sy,
      sr * cp * cy - cr * sp * sy,
      cr * sp * cy + sr * cp * sy,
      cr * cp * sy - sr * sp * cy,
    ];
  },

  /** Quaternion [w,x,y,z] → Euler (degrees, ZYX). Matches Madgwick.getEulerDeg. */
  toEulerDeg(q) {
    const [w, x, y, z] = q;
    const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
    const sinp = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
    const pitch = Math.asin(sinp);
    const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
    return { roll: roll * R2D, pitch: pitch * R2D, yaw: yaw * R2D };
  },

  /** Conjugate (= inverse for a unit quaternion). */
  conjugate(q) {
    return [q[0], -q[1], -q[2], -q[3]];
  },

  /** Hamilton product a ⊗ b. */
  multiply(a, b) {
    const [aw, ax, ay, az] = a;
    const [bw, bx, by, bz] = b;
    return [
      aw * bw - ax * bx - ay * by - az * bz,
      aw * bx + ax * bw + ay * bz - az * by,
      aw * by - ax * bz + ay * bw + az * bx,
      aw * bz + ax * by - ay * bx + az * bw,
    ];
  },

  /** Normalize to unit length (returns identity if degenerate). */
  normalize(q) {
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    if (!n) return [1, 0, 0, 0];
    return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
  },

  /** Xoay vector v bởi quaternion q: v' = q ⊗ [0,v] ⊗ q* */
  rotateVector(q, v) {
    const [w, x, y, z] = q;
    const [vx, vy, vz] = v;
    // t = 2 * (q_vec × v)
    const tx = 2 * (y * vz - z * vy);
    const ty = 2 * (z * vx - x * vz);
    const tz = 2 * (x * vy - y * vx);
    // v' = v + w*t + q_vec × t
    return [
      vx + w * tx + (y * tz - z * ty),
      vy + w * ty + (z * tx - x * tz),
      vz + w * tz + (x * ty - y * tx),
    ];
  },

  /**
   * Tách q thành swing ⊗ twist quanh trục axis (unit vector).
   * twist = xoay quanh trục xương (int/ext rotation, pro/sup);
   * swing = phần gập/lệch còn lại (flexion, abduction, deviation).
   * @param {number[]} q - quaternion [w,x,y,z]
   * @param {number[]} axis - unit vector [x,y,z] (trục xương)
   * @returns {{ swing: number[], twist: number[], angleDeg: number }}
   */
  swingTwist(q, axis) {
    const [w, qx, qy, qz] = q;
    // Chiếu phần vector của q lên axis
    const d = qx * axis[0] + qy * axis[1] + qz * axis[2];
    const twist = Quaternion.normalize([w, d * axis[0], d * axis[1], d * axis[2]]);
    const swing = Quaternion.multiply(q, Quaternion.conjugate(twist));
    // Góc twist CÓ DẤU (signed)
    const angleDeg = 2 * Math.atan2(d, w) * R2D;
    return { swing, twist, angleDeg };
  },

  /**
   * Góc giữa 2 vector đơn vị (degrees), phạm vi 0–180°.
   * Dùng cho elbow flexion: tránh asin ±90° bão hòa.
   * @param {number[]} a - unit vector [x,y,z]
   * @param {number[]} b - unit vector [x,y,z]
   * @returns {number} angle in degrees
   */
  angleBetweenDeg(a, b) {
    const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const cx = a[1] * b[2] - a[2] * b[1];
    const cy = a[2] * b[0] - a[0] * b[2];
    const cz = a[0] * b[1] - a[1] * b[0];
    const crossNorm = Math.sqrt(cx * cx + cy * cy + cz * cz);
    return Math.atan2(crossNorm, dot) * R2D;
  },
};
