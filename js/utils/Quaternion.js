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
};
