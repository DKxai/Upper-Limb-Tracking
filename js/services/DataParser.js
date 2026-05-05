/**
 * DataParser - Parse incoming serial data into structured SensorData
 * Supports multiple formats: JSON, CSV, and custom binary-like formats.
 */

import { IMUReading } from '../models/SensorData.js';
import { ArmSegment, SEGMENT_BY_INDEX, SENSOR_CONFIG } from '../utils/Constants.js';

export class DataParser {
  constructor() {
    this._parseErrors = 0;
    this._parseCount = 0;
    this._lastFormat = null;
    this.lastRawLine = null;
  }

  /**
   * Parse a raw line of data from ESP32
   * Auto-detects format and returns structured readings
   * @param {string} line - Raw string line
   * @returns {{ timestamp: number, readings: Object.<string, IMUReading> } | null}
   */
  parse(line) {
    this._parseCount++;
    this.lastRawLine = line;

    // Try JSON format first
    if (line.startsWith('{')) {
      const result = this._parseJSON(line);
      if (result) {
        this._lastFormat = 'json';
        return result;
      }
    }

    // Try CSV format
    if (line.includes(',')) {
      const result = this._parseCSV(line);
      if (result) {
        this._lastFormat = 'csv';
        return result;
      }
    }

    // Try space-separated values
    if (line.includes(' ') || line.includes('\t')) {
      const result = this._parseSSV(line);
      if (result) {
        this._lastFormat = 'ssv';
        return result;
      }
    }

    this._parseErrors++;
    return null;
  }

  /**
   * Parse JSON format:
   * Raw IMU:    {"t":12345,"s1":{"ax":0.1,"ay":-0.98,"az":0.05,"gx":1.2,"gy":-0.5,"gz":0.3},"s2":{...}}
   * Orientation:{"t":12345,"s1":{"r":12.3,"p":-5.6,"y":3.2},"s2":{"r":8.4,"p":-2.3,"y":1.0}}
   * @param {string} line
   * @returns {Object|null}
   * @private
   */
  _parseJSON(line) {
    try {
      const data = JSON.parse(line);
      const timestamp = data.t || data.timestamp || data.ts || 0;

      // Dynamically find sensor data (s1-s7 or sensor1-sensor7)
      const sensors = {};
      for (let i = 1; i <= SENSOR_CONFIG.NUM_SENSORS; i++) {
        const s = data[`s${i}`] || data[`sensor${i}`] || data[`n${i}`];
        if (s) {
          const segment = SEGMENT_BY_INDEX[i];
          if (segment) sensors[segment] = s;
        }
      }
      // Also support legacy keys
      if (data.upper_arm || data.ua) sensors[ArmSegment.UPPER_ARM] = data.upper_arm || data.ua;
      if (data.forearm || data.fa) sensors[ArmSegment.FOREARM] = data.forearm || data.fa;

      if (Object.keys(sensors).length === 0) return null;

      // Detect data mode from first available sensor
      const sample = Object.values(sensors)[0];
      const isOrientation = ('r' in sample || 'p' in sample || 'y' in sample)
        && !('ax' in sample);

      if (isOrientation) {
        const orientations = {};
        for (const [seg, s] of Object.entries(sensors)) {
          orientations[seg] = { roll: s.r || 0, pitch: s.p || 0, yaw: s.y || 0 };
        }
        return { timestamp, orientations, mode: 'orientation' };
      } else {
        const readings = {};
        for (const [seg, s] of Object.entries(sensors)) {
          readings[seg] = this._imuFromObj(s);
        }
        return { timestamp, readings, mode: 'raw' };
      }
    } catch {
      return null;
    }
  }

  /**
   * Parse CSV format:
   * timestamp,ax1,ay1,az1,gx1,gy1,gz1,ax2,ay2,az2,gx2,gy2,gz2,ax3,ay3,az3,gx3,gy3,gz3
   * (19 values: 1 timestamp + 6*3 sensor data)
   * @param {string} line
   * @returns {Object|null}
   * @private
   */
  _parseCSV(line) {
    try {
      const values = line.split(',').map(v => parseFloat(v.trim()));

      // Minimum: timestamp + 1 sensor (7 values)
      if (values.length < 7 || values.some(isNaN)) return null;

      const timestamp = values[0];
      const readings = {};

      // Dynamically parse up to MAX nodes (6 values per node)
      const maxNodes = Math.min(SENSOR_CONFIG.NUM_SENSORS, Math.floor((values.length - 1) / 6));
      for (let n = 0; n < maxNodes; n++) {
        const offset = 1 + n * 6;
        if (values.length < offset + 6) break;

        const segment = SEGMENT_BY_INDEX[n + 1]; // node_ID is 1-based
        if (!segment) continue;

        // Skip all-zero nodes (inactive)
        const ax = values[offset], ay = values[offset+1], az = values[offset+2];
        const gx = values[offset+3], gy = values[offset+4], gz = values[offset+5];
        if (ax === 0 && ay === 0 && az === 0 && gx === 0 && gy === 0 && gz === 0) continue;

        readings[segment] = new IMUReading(ax, ay, az, gx, gy, gz);
      }

      if (Object.keys(readings).length === 0) return null;
      return { timestamp, readings, mode: 'raw' };
    } catch {
      return null;
    }
  }

  /**
   * Parse space/tab separated values (same field order as CSV)
   * @param {string} line
   * @returns {Object|null}
   * @private
   */
  _parseSSV(line) {
    try {
      const csvLine = line.replace(/\s+/g, ',');
      return this._parseCSV(csvLine);
    } catch {
      return null;
    }
  }

  /**
   * Create IMUReading from a JSON object
   * @param {Object} obj
   * @returns {IMUReading}
   * @private
   */
  _imuFromObj(obj) {
    return new IMUReading(
      obj.ax || obj.accelX || obj.aX || 0,
      obj.ay || obj.accelY || obj.aY || 0,
      obj.az || obj.accelZ || obj.aZ || 0,
      obj.gx || obj.gyroX || obj.gX || 0,
      obj.gy || obj.gyroY || obj.gY || 0,
      obj.gz || obj.gyroZ || obj.gZ || 0,
    );
  }

  /**
   * Get parser statistics
   * @returns {{ total: number, errors: number, errorRate: number, lastFormat: string }}
   */
  getStats() {
    return {
      total: this._parseCount,
      errors: this._parseErrors,
      errorRate: this._parseCount > 0
        ? Math.round((this._parseErrors / this._parseCount) * 100)
        : 0,
      lastFormat: this._lastFormat,
      lastRawLine: this.lastRawLine,
    };
  }

  /** Reset statistics */
  resetStats() {
    this._parseErrors = 0;
    this._parseCount = 0;
  }
}
