/**
 * CalibrationData - Per-node IMU calibration parameters
 * 
 * Accel calibration: a_cal = M × (a_raw_ms2 - bias)   [output: m/s²]
 *   - a_raw_ms2 = raw_g × LOCAL_G
 *   - bias is in m/s²
 *   - M is 3×3 scale/cross-coupling matrix
 * 
 * Gyro calibration:  g_cal = K × (g_raw_dps + bias)   [output: °/s]
 *   - K is per-axis scale factor
 *   - bias is in °/s (added, not subtracted — convention from user's calib)
 */

export const LOCAL_G = 9.80665;

/**
 * Default calibration data (from user's lab calibration).
 * Update each node's entry when per-node calibration is available.
 */
const DEFAULT_CALIB = {
  accel: {
    M: [
      [0.990771, -0.000111,  0.001781],
      [-0.000111,  0.992433, -0.000858],
      [0.001781, -0.000858,  0.985866]
    ],
    bias: [0.455492, -0.032515, -1.270784]  // m/s²
  },
  gyro: {
    K: [0.99356526, 1.01263677, 1.00830049],
    bias: [0.74641912, -0.88067520, 2.27754587]  // °/s
  }
};

/**
 * Node 1 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 * accel.M = S (đối xứng), bias đơn vị m/s²; gyro K + bias (°/s).
 */
const NODE1_CALIB = {
  accel: {
    M: [
      [0.992636, -0.000123,  0.001343],
      [-0.000123,  0.994363, -0.001070],
      [0.001343, -0.001070,  0.989107]
    ],
    bias: [0.432008, -0.042612, -1.098284]  // m/s²
  },
  gyro: {
    K: [1.05674187, 1.00193541, 1.01461782],
    bias: [0.80316301, -0.98965160, 1.32338875]  // °/s
  }
};

/**
 * Node 2 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 */
const NODE2_CALIB = {
  accel: {
    M: [
      [1.004494,  0.000043,  0.003032],
      [0.000043,  1.000284, -0.000519],
      [0.003032, -0.000519,  0.981801]
    ],
    bias: [0.330852, -0.082650, -0.007194]  // m/s²
  },
  gyro: {
    K: [1.01257818, 0.99328011, 1.02104048],
    bias: [3.02716806, 0.48506278, 1.97449240]  // °/s
  }
};

/**
 * Node 3 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 */
const NODE3_CALIB = {
  accel: {
    M: [
      [1.000799, -0.000190, -0.000277],
      [-0.000190,  0.999013, -0.002093],
      [-0.000277, -0.002093,  0.980925]
    ],
    bias: [0.207642, -0.014107, 2.540536]  // m/s²
  },
  gyro: {
    K: [1.01818152, 1.00436446, 1.01478869],
    bias: [4.76537276, 0.13433641, 1.15726779]  // °/s
  }
};

/**
 * Node 4 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 */
const NODE4_CALIB = {
  accel: {
    M: [
      [0.997803, -0.000077,  0.001582],
      [-0.000077,  0.994631, -0.002504],
      [0.001582, -0.002504,  0.979767]
    ],
    bias: [0.337451, -0.131252, -0.644201]  // m/s²
  },
  gyro: {
    K: [1.06483560, 1.00026472, 1.00266134],
    bias: [1.54078163, 1.60204788, 0.68298666]  // °/s
  }
};

/**
 * Node 5 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 */
const NODE5_CALIB = {
  accel: {
    M: [
      [0.998540, -0.000014,  0.000024],
      [-0.000014,  0.998468, -0.000963],
      [0.000024, -0.000963,  0.990635]
    ],
    bias: [0.340734, -0.132490, -0.060494]  // m/s²
  },
  gyro: {
    K: [1.02443591, 1.00486349, 1.00538654],
    bias: [3.46332828, 0.48476798, -0.36005941]  // °/s
  }
};

/**
 * Node 6 — calibrated from lab data (gyro 360° Wang2024 + accel GNLS Hassan).
 */
const NODE6_CALIB = {
  accel: {
    M: [
      [1.006291, -0.000079, -0.001651],
      [-0.000079,  1.003179, -0.000024],
      [-0.001651, -0.000024,  0.994116]
    ],
    bias: [0.193657, -0.099262, -0.229912]  // m/s²
  },
  gyro: {
    K: [1.01675178, 0.98783246, 1.02492568],
    bias: [1.28105679, -2.74487337, 0.02055816]  // °/s
  }
};

/**
 * Per-node calibration data.
 * Keys are node IDs (1-6). Currently all use default.
 * Replace individual entries when per-node calib data is available.
 */
export const CALIBRATION = {
  1: NODE1_CALIB,
  2: NODE2_CALIB,
  3: NODE3_CALIB,
  4: NODE4_CALIB,
  5: NODE5_CALIB,
  6: NODE6_CALIB,
};

/**
 * Apply calibration to raw IMU readings.
 * 
 * @param {number} nodeId - Node ID (1-6)
 * @param {number} ax_g - Raw accel X in g
 * @param {number} ay_g - Raw accel Y in g
 * @param {number} az_g - Raw accel Z in g
 * @param {number} gx_dps - Raw gyro X in °/s
 * @param {number} gy_dps - Raw gyro Y in °/s
 * @param {number} gz_dps - Raw gyro Z in °/s
 * @returns {{ ax: number, ay: number, az: number, gx: number, gy: number, gz: number }}
 *   ax/ay/az in m/s², gx/gy/gz in °/s (calibrated)
 */
export function applyCalibration(nodeId, ax_g, ay_g, az_g, gx_dps, gy_dps, gz_dps) {
  const cal = CALIBRATION[nodeId];

  // --- Fallback: no calibration, just convert accel to m/s² ---
  if (!cal) {
    return {
      ax: ax_g * LOCAL_G,
      ay: ay_g * LOCAL_G,
      az: az_g * LOCAL_G,
      gx: gx_dps,
      gy: gy_dps,
      gz: gz_dps,
    };
  }

  // --- Accel calibration: a_cal = M × (a_raw_ms2 - bias) ---
  const { M, bias } = cal.accel;
  const rx = ax_g * LOCAL_G - bias[0];
  const ry = ay_g * LOCAL_G - bias[1];
  const rz = az_g * LOCAL_G - bias[2];

  const ax = M[0][0] * rx + M[0][1] * ry + M[0][2] * rz;
  const ay = M[1][0] * rx + M[1][1] * ry + M[1][2] * rz;
  const az = M[2][0] * rx + M[2][1] * ry + M[2][2] * rz;

  // --- Gyro calibration: g_cal = K × (g_raw + bias) ---
  const { K, bias: gBias } = cal.gyro;
  const gx = K[0] * (gx_dps + gBias[0]);
  const gy = K[1] * (gy_dps + gBias[1]);
  const gz = K[2] * (gz_dps + gBias[2]);

  return { ax, ay, az, gx, gy, gz };
}
