/**
 * ChartViewModel - Prepares data for Chart.js rendering
 * Handles buffer windowing, throttled updates, and dataset formatting.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, BUFFER_CONFIG, CHART_CONFIG, ArmSegment, SEGMENT_LABELS, SEGMENT_COLORS, AXIS_COLORS, SENSOR_CONFIG } from '../utils/Constants.js';
import { SignalProcessing } from '../services/SignalProcessing.js';

export class ChartViewModel {
  /**
   * @param {import('./DataProcessingVM.js').DataProcessingViewModel} dataVM
   */
  constructor(dataVM) {
    this.dataVM = dataVM;
    this._chartWindow = BUFFER_CONFIG.CHART_WINDOW;
    this._lastUpdate = 0;
    this._updateInterval = CHART_CONFIG.UPDATE_INTERVAL_MS;
    this._pendingUpdate = false;
    // When set (clinical single-session analysis), all getters read from this
    // stored session over its full length instead of the live rolling buffer.
    this._analysisSession = null;
    // Live "whole session so far" mode: when true, live charts span the entire
    // buffered session instead of the rolling CHART_WINDOW. (Persisted by the view.)
    this._liveFullSession = false;
  }

  /** The session the chart getters read from (analysis override, else live). */
  get _session() {
    return this._analysisSession || this.dataVM.session;
  }

  /**
   * Window size the getters read over:
   *  - analysis session → its full length
   *  - live + full-session toggle → the whole live buffer so far
   *  - live (default) → the rolling chart window
   */
  _win() {
    if (this._analysisSession) return this._analysisSession.samples.length;
    if (this._liveFullSession) return this.dataVM.session.samples.length || this._chartWindow;
    return this._chartWindow;
  }

  /** Toggle live charts between rolling window and whole-session-so-far. */
  setLiveFullSession(on) {
    this._liveFullSession = !!on;
  }

  /** Whether live charts currently span the whole buffered session. */
  get liveFullSession() {
    return this._liveFullSession;
  }

  /** Analyze a specific stored session (e.g. one recorded training session). */
  setAnalysisSession(session) {
    this._analysisSession = session || null;
  }

  /** Return to live data. */
  clearAnalysisSession() {
    this._analysisSession = null;
  }

  /**
   * Initialize and listen for processed data
   */
  init() {
    eventBus.on(Events.PROCESSED_DATA_READY, () => {
      this._scheduleUpdate();
    });
  }

  /**
   * Schedule throttled chart update
   * @private
   */
  _scheduleUpdate() {
    if (this._pendingUpdate) return;

    const now = performance.now();
    const elapsed = now - this._lastUpdate;

    if (elapsed >= this._updateInterval) {
      this._lastUpdate = now;
      eventBus.emit('charts:update');
    } else {
      this._pendingUpdate = true;
      setTimeout(() => {
        this._pendingUpdate = false;
        this._lastUpdate = performance.now();
        eventBus.emit('charts:update');
      }, this._updateInterval - elapsed);
    }
  }

  /** Get chart window size */
  get windowSize() {
    return this._chartWindow;
  }

  /** Set chart window size */
  set windowSize(size) {
    this._chartWindow = Math.max(50, Math.min(BUFFER_CONFIG.MAX_SAMPLES, size));
  }

  /**
   * Get frame labels (X-axis)
   * @returns {number[]}
   */
  getLabels() {
    return this._session.getFrameIndices(this._win());
  }

  /**
   * Get time labels in seconds
   * @returns {number[]}
   */
  getTimeLabels() {
    return this._session.getTimestamps(this._win());
  }

  // ═══════════════════════════════════════════════
  //   DATASET GENERATORS FOR EACH CHART TYPE
  // ═══════════════════════════════════════════════

  /**
   * Accelerometer XYZ for a specific segment
   * @param {string} segment - ArmSegment value
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAccelData(segment) {
    const session = this._session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: `Accel X`,
          data: session.getTimeSeries(`raw.${segment}.ax`, this._win()),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: `Accel Y`,
          data: session.getTimeSeries(`raw.${segment}.ay`, this._win()),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: `Accel Z`,
          data: session.getTimeSeries(`raw.${segment}.az`, this._win()),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Node activity for a segment: accelerometer magnitude |a| and gyroscope
   * magnitude |ω| as two compact traces — a quick "is this node moving / alive"
   * read independent of axis orientation.
   * @param {string} segment
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getNodeActivityData(segment) {
    const s = this._session, w = this._win();
    const ax = s.getTimeSeries(`raw.${segment}.ax`, w);
    const ay = s.getTimeSeries(`raw.${segment}.ay`, w);
    const az = s.getTimeSeries(`raw.${segment}.az`, w);
    const gx = s.getTimeSeries(`raw.${segment}.gx`, w);
    const gy = s.getTimeSeries(`raw.${segment}.gy`, w);
    const gz = s.getTimeSeries(`raw.${segment}.gz`, w);
    const aMag = ax.map((_, i) => Math.hypot(ax[i], ay[i], az[i]));
    const gMag = gx.map((_, i) => Math.hypot(gx[i], gy[i], gz[i]));
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: '|a| (g)', data: aMag,
          borderColor: SEGMENT_COLORS[segment], backgroundColor: 'transparent',
          borderWidth: 1.5, pointRadius: 0, fill: false,
        },
        {
          label: '|ω| (°/s)', data: gMag, yAxisID: 'y1',
          borderColor: 'rgba(148,163,184,0.8)', backgroundColor: 'transparent',
          borderWidth: 1, pointRadius: 0, fill: false,
        },
      ],
    };
  }

  /**
   * Gyroscope XYZ for a specific segment
   * @param {string} segment
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getGyroData(segment) {
    const session = this._session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: `Gyro X`,
          data: session.getTimeSeries(`raw.${segment}.gx`, this._win()),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: `Gyro Y`,
          data: session.getTimeSeries(`raw.${segment}.gy`, this._win()),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: `Gyro Z`,
          data: session.getTimeSeries(`raw.${segment}.gz`, this._win()),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Roll/Pitch/Yaw orientation for a specific segment
   * @param {string} segment
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getOrientationData(segment) {
    const session = this._session;
    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: 'Roll',
          data: session.getTimeSeries(`orientation.${segment}.roll`, this._win()),
          borderColor: AXIS_COLORS.x,
          backgroundColor: AXIS_COLORS.x + '20',
        },
        {
          label: 'Pitch',
          data: session.getTimeSeries(`orientation.${segment}.pitch`, this._win()),
          borderColor: AXIS_COLORS.y,
          backgroundColor: AXIS_COLORS.y + '20',
        },
        {
          label: 'Yaw',
          data: session.getTimeSeries(`orientation.${segment}.yaw`, this._win()),
          borderColor: AXIS_COLORS.z,
          backgroundColor: AXIS_COLORS.z + '20',
        },
      ],
    };
  }

  /**
   * Joint angles over time (all joints)
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getJointAnglesData() {
    const session = this._session;
    const colors = ['#3b82f6', '#06b6d4', '#ef4444', '#f97316']; // L-Shoulder, L-Elbow, R-Shoulder, R-Elbow

    return {
      labels: this.getLabels(),
      datasets: [
        {
          label: 'L-Shoulder Flexion',
          data: session.getTimeSeries('jointAngles.leftShoulderFlexion', this._win()),
          borderColor: colors[0],
          backgroundColor: colors[0] + '20',
        },
        {
          label: 'L-Elbow Flexion',
          data: session.getTimeSeries('jointAngles.leftElbowFlexion', this._win()),
          borderColor: colors[1],
          backgroundColor: colors[1] + '20',
        },
        {
          label: 'R-Shoulder Flexion',
          data: session.getTimeSeries('jointAngles.rightShoulderFlexion', this._win()),
          borderColor: colors[2],
          backgroundColor: colors[2] + '20',
        },
        {
          label: 'R-Elbow Flexion',
          data: session.getTimeSeries('jointAngles.rightElbowFlexion', this._win()),
          borderColor: colors[3],
          backgroundColor: colors[3] + '20',
        },
      ],
    };
  }

  /**
   * All joint angles of ONE arm over time (shoulder flexion/abduction, elbow
   * flexion, wrist flexion/deviation) — used to split the overview chart per arm
   * instead of lumping only the main flexion angles together.
   * @param {'left'|'right'} side
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getArmJointAnglesData(side) {
    const session = this._session;
    const p = side === 'left' ? 'left' : 'right';
    const cap = side === 'left' ? 'L' : 'R';
    const colors = ['#3b82f6', '#22c55e', '#06b6d4', '#a855f7', '#f97316'];
    const defs = [
      [`${cap}-Shoulder Flexion`, `jointAngles.${p}ShoulderFlexion`],
      [`${cap}-Shoulder Abduction`, `jointAngles.${p}ShoulderAbduction`],
      [`${cap}-Elbow Flexion`, `jointAngles.${p}ElbowFlexion`],
      [`${cap}-Wrist Flexion`, `jointAngles.${p}WristFlexion`],
      [`${cap}-Wrist Deviation`, `jointAngles.${p}WristDeviation`],
    ];
    return {
      labels: this.getLabels(),
      datasets: defs.map(([label, path], i) => ({
        label,
        data: session.getTimeSeries(path, this._win()),
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
      })),
    };
  }

  /**
   * Angular velocity per joint
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAngularVelocityData() {
    const session = this._session;
    const joints = ['leftShoulderFlexion', 'leftElbowFlexion', 'rightShoulderFlexion', 'rightElbowFlexion'];
    const labels = ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'];
    const colors = ['#3b82f6', '#06b6d4', '#ef4444', '#f97316'];
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;

    const datasets = joints.map((joint, i) => {
      const angles = session.getTimeSeries(`jointAngles.${joint}`, this._win());
      const velocity = [0];
      for (let j = 1; j < angles.length; j++) {
        velocity.push(Math.round(((angles[j] - angles[j - 1]) / dt) * 100) / 100);
      }
      return {
        label: `${labels[i]} (°/s)`,
        data: velocity,
        borderColor: colors[i],
        backgroundColor: colors[i] + '20',
      };
    });

    return { labels: this.getLabels(), datasets };
  }

  /**
   * FFT spectrum data for a specific path
   * @param {string} path
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getFFTData(path) {
    const { frequencies, magnitudes } = this.dataVM.getFFT(path);
    return {
      labels: frequencies,
      datasets: [{
        label: 'Magnitude',
        data: magnitudes,
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.3)',
        fill: true,
      }],
    };
  }

  /**
   * Clinical FFT spectrum data (computed over the full clinical session window)
   * Computed on the angular velocity to match SPARC calculation.
   * @param {string} jointPath
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getClinicalFFTData(jointPath) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    if (rawData.length < 16) return { labels: [], datasets: [] };

    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 5);

    const { frequencies, magnitudes } = SignalProcessing.fft(data, SENSOR_CONFIG.SAMPLE_RATE_HZ);

    const filteredFreqs = [];
    const filteredMags = [];
    for (let i = 0; i < frequencies.length; i++) {
      if (frequencies[i] <= 10) {
        // Round to 2 decimal places to prevent messy labels
        filteredFreqs.push(Math.round(frequencies[i] * 100) / 100);
        filteredMags.push(magnitudes[i]);
      }
    }

    return {
      labels: filteredFreqs,
      datasets: [{
        label: 'Biên độ phổ',
        data: filteredMags,
        borderColor: '#eab308',
        backgroundColor: 'rgba(234, 179, 8, 0.2)',
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
        tension: 0.2
      }],
    };
  }

  /**
   * Movement trajectory (XY plane from accel)
   * @param {string} segment
   * @returns {{ datasets: Object[] }}
   */
  getTrajectoryData(segment) {
    const session = this._session;
    const rollData = session.getTimeSeries(`orientation.${segment}.roll`, this._win());
    const pitchData = session.getTimeSeries(`orientation.${segment}.pitch`, this._win());

    const xyData = rollData.map((r, i) => ({ x: r, y: pitchData[i] || 0 }));

    return {
      datasets: [{
        label: SEGMENT_LABELS[segment],
        data: xyData,
        borderColor: SEGMENT_COLORS[segment],
        backgroundColor: SEGMENT_COLORS[segment] + '40',
        showLine: true,
        pointRadius: 0,
      }],
    };
  }

  /**
   * ROM comparison bar chart data
   * @returns {{ labels: string[], datasets: Object[] }}
   */
  getROMData() {
    const rom = this._session.getROM();
    return {
      labels: ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'],
      datasets: [
        {
          label: 'Measured ROM (°)',
          data: [
            rom.leftShoulderFlexion || 0,
            rom.leftElbowFlexion || 0,
            rom.rightShoulderFlexion || 0,
            rom.rightElbowFlexion || 0,
          ],
          backgroundColor: ['#3b82f6', '#06b6d4', '#ef4444', '#f97316'],
          borderRadius: 6,
        },
        {
          label: 'Normal ROM (°)',
          data: [180, 150, 180, 150],
          backgroundColor: 'rgba(148, 163, 184, 0.2)',
          borderRadius: 6,
        },
      ],
    };
  }

  /**
   * Get A/A (Adduction/Abduction) time-series data for individual joint charts
   * @param {string} jointPath - e.g. 'jointAngles.leftShoulderAbduction'
   * @param {string} label
   * @param {string} color
   * @returns {{ labels: number[], datasets: Object[] }}
   */
  getAAChartData(jointPath, label, color) {
    const session = this._session;
    return {
      labels: this.getLabels(),
      datasets: [{
        label: label,
        data: session.getTimeSeries(jointPath, this._win()),
        borderColor: color,
        backgroundColor: color + '20',
        fill: true,
        borderWidth: 1.5,
        pointRadius: 0,
      }],
    };
  }

  /**
   * Get current statistics for stat cards
   * @returns {Object}
   */
  getCurrentStats() {
    const latest = this._session.getLatest();
    const stats = this.dataVM.getStats();

    if (!latest) {
      return {
        leftShoulderAngle: 0,
        leftElbowAngle: 0,
        rightShoulderAngle: 0,
        rightElbowAngle: 0,
        sampleRate: 0,
      };
    }

    return {
      leftShoulderAngle: latest.jointAngles.leftShoulderFlexion || 0,
      leftElbowAngle: latest.jointAngles.leftElbowFlexion || 0,
      rightShoulderAngle: latest.jointAngles.rightShoulderFlexion || 0,
      rightElbowAngle: latest.jointAngles.rightElbowFlexion || 0,
      sampleRate: stats.actualRate,
    };
  }

  // ═══════════════════════════════════════════
  //   CLINICAL ANALYSIS — IMU Pipeline
  //   Ref: imu_to_chart_pipeline_stepper.html
  // ═══════════════════════════════════════════

  /**
   * Moving average filter (low-pass approximation, Pipeline Step 1)
   */
  _smooth(data, windowSize = 5) {
    const half = Math.floor(windowSize / 2);
    return data.map((_, i) => {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - half); j <= Math.min(data.length - 1, i + half); j++) {
        sum += data[j];
        count++;
      }
      return sum / count;
    });
  }

  /**
   * Pipeline Step 4: ω(t) = Δθ/Δt, then re-filter
   * "Lọc lại sau đạo hàm (nhiễu khuếch đại)"
   */
  _computeVelocity(angle, dt) {
    const raw = [0];
    for (let i = 1; i < angle.length; i++) {
      raw.push((angle[i] - angle[i - 1]) / dt);
    }
    return this._smooth(raw, 9); // re-filter (fc≈10Hz equiv)
  }

  /**
   * Pipeline Step 5: SPARC — Spectral Arc Length via FFT
   * SPARC ∈ (-∞, 0): -1~-2 = smooth, < -2.5 = problematic
   */
  _computeSPARC(velocity, dt) {
    const N = velocity.length;
    if (N < 16) return 0;

    // 1. Normalize: v̂ = v / max(|v|)
    const maxV = Math.max(...velocity.map(Math.abs)) || 1e-8;
    const vNorm = velocity.map(v => v / maxV);

    // 2. DFT magnitude spectrum (positive freqs)
    const nFreqs = Math.floor(N / 2) + 1;
    const spectrum = new Array(nFreqs);
    for (let k = 0; k < nFreqs; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const a = -2 * Math.PI * k * n / N;
        re += vNorm[n] * Math.cos(a);
        im += vNorm[n] * Math.sin(a);
      }
      spectrum[k] = Math.sqrt(re * re + im * im) / N;
    }

    // 3. Frequency axis & cutoff
    const fs = 1 / dt;
    const fc = Math.min(20, fs / 2);
    const nUsable = Math.min(nFreqs, Math.ceil(fc * N / fs));

    // 4. Arc length: L = -∫ sqrt((1/ωc)² + |dV/dω|²) dω
    let arcLength = 0;
    for (let k = 1; k < nUsable; k++) {
      const df = fs / N;
      const dV = (spectrum[k] - spectrum[k - 1]) / df;
      arcLength += Math.sqrt((1 / fc) ** 2 + dV * dV) * df;
    }
    return -arcLength;
  }

  /**
   * Clinical summary stats (Pipeline Steps 3-5)
   */
  getClinicalStats(jointPath) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    if (rawData.length < 16) return { rom: 0, peakVelocity: 0, sparc: 0, tremorIndex: 0 };

    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 5);
    const rom = Math.max(...data) - Math.min(...data);

    const velocity = this._computeVelocity(data, dt);
    const peakVelocity = Math.max(...velocity.map(Math.abs));
    const sparc = this._computeSPARC(velocity, dt);

    // Tremor Index: high-freq residual ratio
    const smoothVel = this._smooth(velocity, 15);
    const velMean = velocity.reduce((s, v) => s + v, 0) / velocity.length;
    let totalVar = 0, hfVar = 0;
    for (let i = 0; i < velocity.length; i++) {
      totalVar += (velocity[i] - velMean) ** 2;
      hfVar += (velocity[i] - smoothVel[i]) ** 2;
    }
    const tremorIndex = totalVar > 0 ? hfVar / totalVar : 0;

    return {
      rom: Math.round(rom * 10) / 10,
      peakVelocity: Math.round(peakVelocity * 10) / 10,
      sparc: Math.round(sparc * 100) / 100,
      tremorIndex: Math.round(tremorIndex * 100) / 100,
    };
  }

  /**
   * Velocity & Acceleration time-series (Pipeline Step 4)
   */
  getVelocityAccelerationData(jointPath) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const labels = this.getLabels();

    const data = this._smooth(rawData, 5);
    const velocity = this._computeVelocity(data, dt);
    const acceleration = this._computeVelocity(velocity, dt);

    return {
      labels,
      datasets: [
        {
          label: 'Vận tốc góc (°/s)',
          data: velocity,
          borderColor: '#3b82f6',
          backgroundColor: '#3b82f620',
          fill: true, borderWidth: 1.5, pointRadius: 0,
        },
        {
          label: 'Gia tốc góc (°/s²)',
          data: acceleration,
          borderColor: '#f97316',
          backgroundColor: '#f9731620',
          fill: true, borderWidth: 1.5, pointRadius: 0,
        },
      ],
    };
  }

  /**
   * Repetition segmentation: split a (smoothed) joint-angle signal into movement
   * cycles. A "rep" spans valley→valley around one peak (e.g. one flexion-extension).
   *
   * Uses hysteresis turning-point detection (a.k.a. zig-zag): a new extremum is
   * only confirmed once the signal reverses by more than `h` from the running
   * extreme, so ripples/tremor smaller than `h` never spawn a rep. This is the
   * key fix for over-segmentation — the previous peak-height-threshold approach
   * counted every little oscillation on a held plateau as a separate rep (e.g.
   * "81 reps · ROM 3.9°"). It is also direction-agnostic: it works whether the
   * rest pose is low (upward flexion reps) or high (downward excursions).
   *
   * Returns null when the signal can't be meaningfully segmented (too short, too
   * little movement, or fewer than 2 valleys) — callers then treat it as one phase.
   * @param {number[]} data - smoothed angle samples
   * @param {number} dt - seconds per sample
   * @returns {{start:number,end:number,peak:number}[]|null}
   */
  _segmentReps(data, dt) {
    const n = data.length;
    const minDist = Math.max(8, Math.round(0.35 / dt)); // reps ≥ ~0.35s long
    if (n < 2 * minDist) return null;

    const min = Math.min(...data), max = Math.max(...data);
    const amp = max - min;
    if (amp < 15) return null; // not enough range to be a repetition

    // Reversal threshold: a turn only counts once the signal retraces ≥ h. 15% of
    // the full range (floor 8°) rejects tremor/hold ripples but keeps real reps.
    const h = Math.max(8, 0.15 * amp);

    // Hysteresis turning-point scan → alternating significant minima/maxima.
    const extrema = []; // {index, type:'min'|'max'}
    let upMax = data[0], upMaxIdx = 0;   // running max since last confirmed min
    let dnMin = data[0], dnMinIdx = 0;   // running min since last confirmed max
    let trend = 0;                       // 0 unknown, +1 rising, -1 falling
    for (let i = 1; i < n; i++) {
      const v = data[i];
      if (v > upMax) { upMax = v; upMaxIdx = i; }
      if (v < dnMin) { dnMin = v; dnMinIdx = i; }
      if (trend !== -1 && v <= upMax - h) {
        extrema.push({ index: upMaxIdx, type: 'max' });
        trend = -1; dnMin = v; dnMinIdx = i;
      } else if (trend !== 1 && v >= dnMin + h) {
        extrema.push({ index: dnMinIdx, type: 'min' });
        trend = 1; upMax = v; upMaxIdx = i;
      }
    }
    // Close out the final (still-pending) extremum in the current trend.
    if (trend === 1) extrema.push({ index: upMaxIdx, type: 'max' });
    else if (trend === -1) extrema.push({ index: dnMinIdx, type: 'min' });

    // Reps = valley → valley, with the highest sample between them as the peak.
    const valleys = extrema.filter(e => e.type === 'min').map(e => e.index);
    if (valleys.length < 2) return null;
    const reps = [];
    for (let k = 0; k < valleys.length - 1; k++) {
      const s = valleys[k], e = valleys[k + 1];
      if (e - s < minDist) continue; // too brief to be a real rep
      let peak = s, pv = data[s];
      for (let i = s; i <= e; i++) if (data[i] > pv) { pv = data[i]; peak = i; }
      reps.push({ start: s, end: e, peak });
    }
    return reps.length ? reps : null;
  }

  /**
   * Linearly resample a series to exactly N points over its full span — used to
   * time-normalize a repetition to 0–100% of its cycle so its phase-portrait loop
   * is clean and comparable (the US-standard ensemble/representative convention).
   * @private
   */
  _resample(arr, N) {
    const n = arr.length;
    if (n === 0) return new Array(N).fill(0);
    if (n === 1) return new Array(N).fill(arr[0]);
    const out = new Array(N);
    for (let k = 0; k < N; k++) {
      const t = (k / (N - 1)) * (n - 1);
      const i0 = Math.floor(t), i1 = Math.min(n - 1, i0 + 1), f = t - i0;
      out[k] = arr[i0] * (1 - f) + arr[i1] * f;
    }
    return out;
  }

  /**
   * Central-difference angular velocity with a light re-filter. Central difference
   * (vs the backward difference used elsewhere) is symmetric — no phase lag and
   * less high-frequency noise — which is what keeps the phase-portrait loop from
   * looking jagged. @private
   */
  _centralVelocity(angle, dt) {
    const n = angle.length;
    const v = new Array(n).fill(0);
    for (let i = 1; i < n - 1; i++) v[i] = (angle[i + 1] - angle[i - 1]) / (2 * dt);
    if (n > 1) {
      v[0] = (angle[1] - angle[0]) / dt;
      v[n - 1] = (angle[n - 1] - angle[n - 2]) / dt;
    }
    return this._smooth(v, 7);
  }

  /**
   * Full-session joint-angle overview: one line spanning the whole session, with
   * the trace recolored per repetition (alternating) so phases are visible at a
   * glance, plus a dashed normal-range threshold. Addresses "bao quát cả buổi".
   * @param {string} jointPath
   * @param {string} label
   * @param {number} normalMax - normal ceiling for the dashed reference line
   */
  getJointAngleOverviewData(jointPath, label, normalMax) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 5);
    const labels = this.getLabels();
    const reps = this._segmentReps(data, dt);

    // Map each sample → its rep index (for alternating segment colors)
    const repOf = new Array(data.length).fill(-1);
    if (reps) reps.forEach((r, ri) => { for (let i = r.start; i <= r.end; i++) repOf[i] = ri; });
    const altA = '#8b5cf6', altB = '#22d3ee';

    const angleDs = {
      label,
      data,
      borderColor: altA,
      backgroundColor: 'transparent',
      borderWidth: 1.8,
      pointRadius: 0,
      tension: 0.2,
      fill: false,
    };
    if (reps) {
      angleDs.segment = {
        borderColor: (ctx) => (repOf[ctx.p0DataIndex] % 2 ? altB : altA),
      };
    }

    return {
      labels,
      datasets: [
        angleDs,
        {
          label: `Ngưỡng bình thường (${normalMax}°)`,
          data: labels.map(() => normalMax),
          borderColor: 'rgba(148, 163, 184, 0.5)',
          backgroundColor: 'transparent',
          borderWidth: 1,
          borderDash: [5, 5],
          pointRadius: 0,
          fill: false,
        },
      ],
      _reps: reps, // surfaced for the rep selector / count
    };
  }

  /**
   * Phase Portrait: θ (angle) vs ω (angular velocity) for ONE representative rep,
   * drawn the US-clinical way — a single clean closed orbit split into its
   * movement phases with the kinematic landmarks marked, instead of a dense
   * tangle of every rep overlaid.
   *
   * - The rep is time-normalized to a fixed cycle length (0–100%) and ω uses a
   *   symmetric central difference, so the loop is smooth and recognizable.
   * - It is split at the angle reversal (peak θ): the rising arc is the
   *   CONCENTRIC phase (flexion, ω > 0, upper half) and the falling arc is the
   *   ECCENTRIC phase (extension, ω < 0, lower half).
   * - Landmarks: start, concentric peak velocity, angle reversal, end.
   *
   * When repIndex is null the median-ROM rep is chosen as "representative";
   * otherwise the selected rep is shown. `_repShown` reports which rep is drawn.
   * @param {string} jointPath
   * @param {number|null} repIndex - selected rep (null = representative)
   */
  getPhasePortraitData(jointPath, repIndex = null) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 7);
    const velocity = this._centralVelocity(data, dt);
    const reps = this._segmentReps(data, dt);

    // Fallback: no clear repetitions → single smoothed trajectory.
    if (!reps || !reps.length) {
      const points = data.map((d, i) => ({ x: d, y: velocity[i] }));
      return {
        datasets: [{
          label: 'Quỹ đạo pha', data: points, showLine: true,
          borderColor: 'rgba(99,102,241,0.7)', backgroundColor: 'transparent',
          borderWidth: 1.5, pointRadius: 0, tension: 0,
        }],
        _reps: [], _repShown: null,
      };
    }

    // Pick the rep to display: the selected one, else the median-ROM rep so the
    // "All" view shows a typical (not the biggest/smallest) cycle.
    const romOf = (r) => {
      let lo = Infinity, hi = -Infinity;
      for (let i = r.start; i <= r.end; i++) { if (data[i] < lo) lo = data[i]; if (data[i] > hi) hi = data[i]; }
      return hi - lo;
    };
    let idx = repIndex;
    if (idx == null) {
      const order = reps.map((r, i) => ({ i, rom: romOf(r) })).sort((a, b) => a.rom - b.rom);
      idx = order[Math.floor(order.length / 2)].i;
    }
    idx = Math.max(0, Math.min(reps.length - 1, idx));
    const rep = reps[idx];

    // Time-normalize the rep to N points → a clean, comparable loop.
    const N = 100;
    const theta = this._resample(data.slice(rep.start, rep.end + 1), N);
    const omega = this._resample(velocity.slice(rep.start, rep.end + 1), N);

    // Reversal = peak angle: splits rising (concentric) from falling (eccentric).
    let revI = 0;
    for (let i = 1; i < N; i++) if (theta[i] > theta[revI]) revI = i;
    // Concentric peak velocity = max +ω before the reversal.
    let pvI = 0;
    for (let i = 1; i <= revI; i++) if (omega[i] > omega[pvI]) pvI = i;

    const concentric = [];
    for (let i = 0; i <= revI; i++) concentric.push({ x: theta[i], y: omega[i] });
    const eccentric = [];
    for (let i = revI; i < N; i++) eccentric.push({ x: theta[i], y: omega[i] });
    const at = (i) => ({ x: theta[i], y: omega[i] });

    return {
      datasets: [
        {
          label: 'Pha đồng tâm (gập)', data: concentric, showLine: true,
          borderColor: '#6366f1', backgroundColor: 'transparent',
          borderWidth: 2.5, pointRadius: 0, tension: 0,
        },
        {
          label: 'Pha ly tâm (duỗi)', data: eccentric, showLine: true,
          borderColor: '#f97316', backgroundColor: 'transparent',
          borderWidth: 2.5, pointRadius: 0, tension: 0,
        },
        {
          label: 'Bắt đầu', data: [at(0)], showLine: false,
          backgroundColor: '#22c55e', borderColor: '#15803d', borderWidth: 1,
          pointRadius: 5, pointStyle: 'circle',
        },
        {
          label: 'Đỉnh vận tốc', data: [at(pvI)], showLine: false,
          backgroundColor: '#3b82f6', borderColor: '#1d4ed8', borderWidth: 1,
          pointRadius: 7, pointStyle: 'triangle',
        },
        {
          label: 'Đảo chiều (đỉnh góc)', data: [at(revI)], showLine: false,
          backgroundColor: '#a855f7', borderColor: '#7e22ce', borderWidth: 1,
          pointRadius: 7, pointStyle: 'rectRot',
        },
        {
          label: 'Kết thúc', data: [at(N - 1)], showLine: false,
          backgroundColor: '#94a3b8', borderColor: '#475569', borderWidth: 1,
          pointRadius: 5, pointStyle: 'circle',
        },
      ],
      _reps: reps, _repShown: idx,
    };
  }

  /**
   * Per-repetition metrics for the rep selector / phase read-out. Besides the
   * whole-rep ROM, peak velocity and SPARC smoothness, each rep is split at its
   * angle reversal into the CONCENTRIC (flexion) and ECCENTRIC (extension) phases
   * with the peak velocity and duration of each — the per-phase analysis a
   * clinician reads off a phase portrait (e.g. an uncontrolled, over-fast
   * eccentric return, or a flexion/extension timing asymmetry).
   * @param {string} jointPath
   * @returns {{rom:number,peakVel:number,sparc:number,concPeakVel:number,
   *            eccPeakVel:number,concDur:number,eccDur:number}[]}
   */
  getRepMetrics(jointPath) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const data = this._smooth(rawData, 5);
    const velocity = this._centralVelocity(data, dt);
    const reps = this._segmentReps(data, dt);
    if (!reps) return [];
    const r1 = (x) => Math.round(x * 10) / 10;
    return reps.map((r) => {
      const seg = data.slice(r.start, r.end + 1);
      const vel = velocity.slice(r.start, r.end + 1);
      const rom = Math.max(...seg) - Math.min(...seg);
      const peakVel = Math.max(...vel.map(Math.abs));
      const sparc = this._computeSPARC(vel, dt);
      // Reversal (peak angle) splits the two phases.
      let revI = 0;
      for (let i = 1; i < seg.length; i++) if (seg[i] > seg[revI]) revI = i;
      const concVel = vel.slice(0, revI + 1);
      const eccVel = vel.slice(revI);
      const concPeakVel = concVel.length ? Math.max(...concVel.map(Math.abs)) : 0;
      const eccPeakVel = eccVel.length ? Math.max(...eccVel.map(Math.abs)) : 0;
      return {
        rom: r1(rom),
        peakVel: r1(peakVel),
        sparc: Math.round(sparc * 100) / 100,
        concPeakVel: r1(concPeakVel),
        eccPeakVel: r1(eccPeakVel),
        concDur: Math.round(revI * dt * 100) / 100,                     // seconds
        eccDur: Math.round((seg.length - 1 - revI) * dt * 100) / 100,   // seconds
      };
    });
  }

  /** Whether the getters are reading a stored (static) analysis session. */
  get isAnalysisSession() {
    return !!this._analysisSession;
  }

  /** Number of samples in the current session window (for the replay scrubber). */
  getSampleCount() {
    return this._session.samples.length;
  }

  /** The raw stored sample at index i (has orientation + jointAngles to pose 3D). */
  getSampleAt(i) {
    return this._session.samples[i] || null;
  }

  /**
   * Pre-computed arrays for the clinical replay/scrubber: smoothed angle,
   * velocity, jerk (with threshold) and the discrete abnormal-jerk spike events
   * (each with time, rep, angle, velocity) so scrubbing reads cheaply without
   * recomputing. Spikes = local maxima of |jerk| above mean+2σ.
   * @param {string} jointPath
   */
  getReplayData(jointPath) {
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const raw = this._session.getTimeSeries(jointPath, this._win());
    const times = this._session.getTimestamps(this._win());
    const n = raw.length;
    if (n < 16) {
      return { count: n, times, angle: raw.slice(), velocity: [], jerk: [], threshold: 0, reps: [], spikes: [] };
    }
    const angle = this._smooth(raw, 5);
    const velocity = this._computeVelocity(angle, dt);
    const accel = this._computeVelocity(velocity, dt);
    const jerk = this._computeVelocity(accel, dt).map(Math.abs);

    const mean = jerk.reduce((s, v) => s + v, 0) / jerk.length;
    const std = Math.sqrt(jerk.reduce((s, v) => s + (v - mean) ** 2, 0) / jerk.length);
    const threshold = mean + 2 * std;

    const reps = this._segmentReps(angle, dt) || [];
    const repOf = (i) => {
      const r = reps.findIndex(rp => i >= rp.start && i <= rp.end);
      return r < 0 ? null : r;
    };

    const spikes = [];
    for (let i = 1; i < n; i++) {
      const isLocalMax = jerk[i] >= jerk[i - 1] && (i + 1 >= n || jerk[i] > jerk[i + 1]);
      if (jerk[i] > threshold && isLocalMax) {
        spikes.push({
          index: i, frac: i / (n - 1), t: times[i], rep: repOf(i),
          angle: Math.round(angle[i]), vel: Math.round(velocity[i]), jerk: Math.round(jerk[i]),
        });
      }
    }
    return { count: n, times, angle, velocity, jerk, threshold: Math.round(threshold), reps, spikes };
  }

  /** Contralateral joint path ('...left...' ↔ '...right...'), or null. @private */
  _contralateral(jointPath) {
    if (jointPath.includes('left')) return jointPath.replace('left', 'right');
    if (jointPath.includes('right')) return jointPath.replace('right', 'left');
    return null;
  }

  /** Decimate an array to at most `cap` samples (cheap stride). @private */
  _decimate(arr, cap) {
    if (arr.length <= cap) return arr.slice();
    const step = arr.length / cap, out = [];
    for (let i = 0; i < cap; i++) out.push(arr[Math.floor(i * step)]);
    return out;
  }

  /** Count speed peaks (submovements) in a velocity segment. @private */
  _submovements(velocity) {
    const speed = velocity.map(Math.abs);
    const peak = Math.max(...speed) || 1;
    const thr = 0.1 * peak;
    let count = 0;
    for (let i = 1; i < speed.length - 1; i++) {
      if (speed[i] > thr && speed[i] >= speed[i - 1] && speed[i] > speed[i + 1]) count++;
    }
    return count;
  }

  /**
   * Log Dimensionless Jerk (LDLJ) for one movement segment — a standard,
   * amplitude/duration-normalized smoothness metric (more negative = smoother).
   * @private
   */
  _ldlj(angleSeg, dt) {
    if (angleSeg.length < 6) return 0;
    const v = this._computeVelocity(angleSeg, dt);
    const a = this._computeVelocity(v, dt);
    const j = this._computeVelocity(a, dt);
    const T = (angleSeg.length - 1) * dt;
    const D = Math.max(...angleSeg) - Math.min(...angleSeg);
    if (T <= 0 || D <= 0) return 0;
    let intJ2 = 0;
    for (const jj of j) intJ2 += jj * jj * dt;
    const dj = Math.sqrt(0.5 * intJ2 * Math.pow(T, 5) / (D * D));
    return dj > 0 ? -Math.log(dj) : 0;
  }

  /**
   * Tremor spectrum of a (zero-mean) signal: dominant frequency in 3–12 Hz and
   * the fraction of spectral energy in the 4–12 Hz tremor band.
   * @private
   */
  _tremorSpectrum(signal, dt) {
    const N = signal.length;
    if (N < 32) return { peakHz: 0, frac: 0 };
    const mean = signal.reduce((s, v) => s + v, 0) / N;
    const x = signal.map(v => v - mean);
    const fs = 1 / dt;
    const nFreqs = Math.floor(N / 2) + 1;
    let total = 0, band = 0, peakHz = 0, peakMag = 0;
    for (let k = 1; k < nFreqs; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const ang = -2 * Math.PI * k * n / N;
        re += x[n] * Math.cos(ang);
        im += x[n] * Math.sin(ang);
      }
      const mag = Math.sqrt(re * re + im * im) / N;
      const f = k * fs / N;
      total += mag;
      if (f >= 4 && f <= 12) band += mag;
      if (f >= 3 && f <= 12 && mag > peakMag) { peakMag = mag; peakHz = f; }
    }
    return { peakHz: Math.round(peakHz * 10) / 10, frac: total > 0 ? band / total : 0 };
  }

  /**
   * Group A clinical metrics for the selected joint, per US clinical standards
   * (AAOS/AMA ROM, SFTR neutral-zero, LSI, SPARC/LDLJ/submovements, tremor
   * frequency, dosing). Computed over the whole analysis/live window.
   * @param {string} jointPath
   * @param {number} normalMax - normal ROM ceiling for this joint
   */
  getClinicalMetrics(jointPath, normalMax) {
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const empty = {
      rom: 0, sftr: '0–0–0', deficit: 0, sideRom: 0, contraRom: 0, lsi: null,
      sparc: 0, ldlj: 0, submov: 0, tremorHz: 0, tremorFrac: 0,
      peakVel: 0, ttp: null, repCount: 0, cadence: 0, cvRom: null, cvPeak: null,
    };
    const raw = this._session.getTimeSeries(jointPath, this._win());
    if (raw.length < 16) return empty;

    const data = this._smooth(raw, 5);
    const min = Math.min(...data), max = Math.max(...data);
    const rom = max - min;
    const velocity = this._computeVelocity(data, dt);

    // Neutral-Zero (SFTR): extension–neutral–flexion. If the joint never returns
    // to 0 (min>0) the middle number is that extension deficit.
    const r = (n) => Math.round(n);
    const sftr = min > 0.5 ? `0–${r(min)}–${r(max)}` : `${r(-min)}–0–${r(max)}`;
    const deficit = Math.max(0, Math.round(((normalMax - rom) / normalMax) * 100));

    // Limb Symmetry Index vs contralateral joint
    const contraPath = this._contralateral(jointPath);
    let contraRom = 0;
    if (contraPath) {
      const cRaw = this._session.getTimeSeries(contraPath, this._win());
      if (cRaw.length >= 16) {
        const c = this._smooth(cRaw, 5);
        contraRom = Math.max(...c) - Math.min(...c);
      }
    }
    const lsi = (rom > 0 && contraRom > 0)
      ? Math.round((Math.min(rom, contraRom) / Math.max(rom, contraRom)) * 100) : null;

    // Smoothness
    const sparc = Math.round(this._computeSPARC(velocity, dt) * 100) / 100;

    // Tremor: spectrum of velocity (decimated to keep the DFT cheap)
    const decim = this._decimate(velocity, 512);
    const tdt = dt * (velocity.length / decim.length);
    const trem = this._tremorSpectrum(decim, tdt);

    // Per-rep: submovements, LDLJ, time-to-peak, consistency
    const reps = this._segmentReps(data, dt);
    let submov = 0, ldlj = 0, ttpSum = 0, repCount = 0;
    const romArr = [], peakArr = [];
    if (reps) {
      repCount = reps.length;
      reps.forEach(rp => {
        const seg = data.slice(rp.start, rp.end + 1);
        const vseg = velocity.slice(rp.start, rp.end + 1);
        submov += this._submovements(vseg);
        ldlj += this._ldlj(seg, dt);
        const sp = vseg.map(Math.abs);
        let pi = 0, pv = -1;
        sp.forEach((s, i) => { if (s > pv) { pv = s; pi = i; } });
        ttpSum += vseg.length > 1 ? (pi / (vseg.length - 1)) * 100 : 0;
        romArr.push(Math.max(...seg) - Math.min(...seg));
        peakArr.push(Math.max(...sp));
      });
    }
    const peakVel = Math.round(Math.max(...velocity.map(Math.abs)) * 10) / 10;
    const cv = (arr) => {
      if (arr.length < 2) return null;
      const m = arr.reduce((s, v) => s + v, 0) / arr.length;
      if (m <= 0) return null;
      const sd = Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
      return Math.round((sd / m) * 100);
    };
    const dur = this._session.getDuration();
    const cadence = dur > 0 && repCount ? Math.round((repCount / (dur / 60)) * 10) / 10 : 0;

    return {
      rom: Math.round(rom * 10) / 10,
      sftr, deficit,
      sideRom: r(rom), contraRom: r(contraRom), lsi,
      sparc,
      ldlj: repCount ? Math.round((ldlj / repCount) * 100) / 100 : 0,
      submov: repCount ? Math.round((submov / repCount) * 10) / 10 : 0,
      tremorHz: trem.peakHz, tremorFrac: Math.round(trem.frac * 100),
      peakVel,
      ttp: repCount ? Math.round(ttpSum / repCount) : null,
      repCount, cadence,
      cvRom: cv(romArr), cvPeak: cv(peakArr),
    };
  }

  /**
   * Jerk with spike detection (Pipeline Step 5)
   * jerk = d(acceleration)/dt
   */
  getJerkData(jointPath) {
    const rawData = this._session.getTimeSeries(jointPath, this._win());
    const dt = 1 / SENSOR_CONFIG.SAMPLE_RATE_HZ;
    const labels = this.getLabels();

    const data = this._smooth(rawData, 5);
    const velocity = this._computeVelocity(data, dt);
    const acceleration = this._computeVelocity(velocity, dt);
    const jerk = this._computeVelocity(acceleration, dt).map(Math.abs);

    const mean = jerk.reduce((s, v) => s + v, 0) / Math.max(jerk.length, 1);
    const std = Math.sqrt(jerk.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(jerk.length, 1));
    const threshold = mean + 2 * std;

    return {
      labels,
      datasets: [
        {
          label: 'Jerk bình thường', data: jerk.map(v => v <= threshold ? v : 0),
          backgroundColor: '#22c55e80', borderColor: '#22c55e', borderWidth: 1, type: 'bar',
        },
        {
          label: 'Spike bất thường', data: jerk.map(v => v > threshold ? v : 0),
          backgroundColor: '#ef444480', borderColor: '#ef4444', borderWidth: 1, type: 'bar',
        },
      ],
    };
  }
}

