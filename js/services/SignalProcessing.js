/**
 * SignalProcessing - Digital signal processing utilities
 * Low-pass filter, FFT, SPARC, and other analysis tools.
 */

import { MathUtils } from '../utils/MathUtils.js';

export class SignalProcessing {
  /**
   * Low-pass filter (first-order IIR)
   * y[n] = α * x[n] + (1-α) * y[n-1]
   * @param {number[]} data
   * @param {number} alpha - Smoothing factor (0-1, lower = smoother)
   * @returns {number[]}
   */
  static lowPassFilter(data, alpha = 0.2) {
    if (data.length === 0) return [];
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(alpha * data[i] + (1 - alpha) * result[i - 1]);
    }
    return result;
  }

  /**
   * High-pass filter
   * @param {number[]} data
   * @param {number} alpha
   * @returns {number[]}
   */
  static highPassFilter(data, alpha = 0.8) {
    if (data.length === 0) return [];
    const result = [data[0]];
    for (let i = 1; i < data.length; i++) {
      result.push(alpha * (result[i - 1] + data[i] - data[i - 1]));
    }
    return result;
  }

  /**
   * Moving average filter
   * @param {number[]} data
   * @param {number} windowSize
   * @returns {number[]}
   */
  static movingAverage(data, windowSize = 5) {
    return MathUtils.movingAverage(data, windowSize);
  }

  /**
   * Median filter (good for removing spikes)
   * @param {number[]} data
   * @param {number} windowSize - Must be odd
   * @returns {number[]}
   */
  static medianFilter(data, windowSize = 5) {
    if (windowSize % 2 === 0) windowSize++;
    const half = Math.floor(windowSize / 2);
    const result = [];

    for (let i = 0; i < data.length; i++) {
      const start = Math.max(0, i - half);
      const end = Math.min(data.length, i + half + 1);
      const window = data.slice(start, end).sort((a, b) => a - b);
      result.push(window[Math.floor(window.length / 2)]);
    }
    return result;
  }

  /**
   * Simple FFT (Cooley-Tukey radix-2 DIT)
   * Input length must be a power of 2
   * @param {number[]} data - Real input
   * @returns {{ frequencies: number[], magnitudes: number[] }}
   */
  static fft(data, sampleRate = 50) {
    // Zero-pad to next power of 2
    let n = 1;
    while (n < data.length) n *= 2;
    const padded = new Array(n).fill(0);
    for (let i = 0; i < data.length; i++) padded[i] = data[i];

    // Remove DC component (mean)
    const mean = padded.reduce((s, v) => s + v, 0) / padded.length;
    for (let i = 0; i < n; i++) padded[i] -= mean;

    // Apply Hanning window
    for (let i = 0; i < n; i++) {
      padded[i] *= 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    }

    // FFT computation
    const real = padded.slice();
    const imag = new Array(n).fill(0);
    this._fftCompute(real, imag, n);

    // Calculate magnitudes (only first half - Nyquist)
    const halfN = Math.floor(n / 2);
    const frequencies = [];
    const magnitudes = [];

    for (let i = 0; i < halfN; i++) {
      frequencies.push(MathUtils.roundTo((i * sampleRate) / n, 2));
      magnitudes.push(MathUtils.roundTo(
        (2 * Math.sqrt(real[i] ** 2 + imag[i] ** 2)) / n,
        4
      ));
    }

    return { frequencies, magnitudes };
  }

  /**
   * In-place FFT computation (Cooley-Tukey)
   * @param {number[]} real
   * @param {number[]} imag
   * @param {number} n
   * @private
   */
  static _fftCompute(real, imag, n) {
    // Bit-reversal permutation
    let j = 0;
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
      let k = n >> 1;
      while (k <= j) {
        j -= k;
        k >>= 1;
      }
      j += k;
    }

    // FFT butterfly
    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2;
      const angle = (-2 * Math.PI) / len;
      const wReal = Math.cos(angle);
      const wImag = Math.sin(angle);

      for (let i = 0; i < n; i += len) {
        let curReal = 1;
        let curImag = 0;

        for (let k = 0; k < halfLen; k++) {
          const tReal = curReal * real[i + k + halfLen] - curImag * imag[i + k + halfLen];
          const tImag = curReal * imag[i + k + halfLen] + curImag * real[i + k + halfLen];

          real[i + k + halfLen] = real[i + k] - tReal;
          imag[i + k + halfLen] = imag[i + k] - tImag;
          real[i + k] += tReal;
          imag[i + k] += tImag;

          const newCurReal = curReal * wReal - curImag * wImag;
          curImag = curReal * wImag + curImag * wReal;
          curReal = newCurReal;
        }
      }
    }
  }

  /**
   * Calculate SPARC (Spectral Arc Length) - Movement Smoothness metric
   * Lower values = smoother movement
   * Reference: Balasubramanian et al. 2012
   * @param {number[]} velocityProfile
   * @param {number} sampleRate
   * @returns {number} SPARC value (negative, closer to 0 = smoother)
   */
  static sparc(velocityProfile, sampleRate = 50) {
    if (velocityProfile.length < 4) return 0;

    const { frequencies, magnitudes } = this.fft(velocityProfile, sampleRate);

    // Normalize magnitudes
    const maxMag = Math.max(...magnitudes);
    if (maxMag === 0) return 0;
    const normMag = magnitudes.map(m => m / maxMag);

    // Find frequency cutoff (where normalized magnitude drops below threshold)
    const threshold = 0.05;
    let cutoffIdx = normMag.length;
    for (let i = 1; i < normMag.length; i++) {
      if (frequencies[i] > 20) { // Max 20Hz
        cutoffIdx = i;
        break;
      }
    }

    // Calculate spectral arc length
    let arcLength = 0;
    for (let i = 1; i < cutoffIdx; i++) {
      const df = frequencies[i] - frequencies[i - 1];
      const dm = normMag[i] - normMag[i - 1];
      arcLength += Math.sqrt(df * df + dm * dm);
    }

    return MathUtils.roundTo(-arcLength, 4);
  }

  /**
   * Calculate jerk (derivative of acceleration)
   * High jerk = jerky/non-smooth movement
   * @param {number[]} data
   * @param {number} dt
   * @returns {number[]}
   */
  static jerk(data, dt = 0.02) {
    return MathUtils.derivative(data, dt);
  }

  /**
   * Calculate jerk RMS (smoothness metric)
   * @param {number[]} data
   * @param {number} dt
   * @returns {number}
   */
  static jerkRMS(data, dt = 0.02) {
    const j = this.jerk(data, dt);
    return MathUtils.rms(j);
  }

  /**
   * Detect peaks/valleys in data
   * @param {number[]} data
   * @param {number} threshold - Minimum height to count as peak
   * @returns {{ peaks: number[], valleys: number[] }} Indices
   */
  static findPeaks(data, threshold = 0) {
    const peaks = [];
    const valleys = [];

    for (let i = 1; i < data.length - 1; i++) {
      if (data[i] > data[i - 1] && data[i] > data[i + 1] && data[i] > threshold) {
        peaks.push(i);
      }
      if (data[i] < data[i - 1] && data[i] < data[i + 1] && data[i] < -threshold) {
        valleys.push(i);
      }
    }

    return { peaks, valleys };
  }

  /**
   * Estimate dominant frequency from data
   * @param {number[]} data
   * @param {number} sampleRate
   * @returns {number} Dominant frequency in Hz
   */
  static dominantFrequency(data, sampleRate = 50) {
    const { frequencies, magnitudes } = this.fft(data, sampleRate);
    // Skip DC (index 0)
    let maxIdx = 1;
    for (let i = 2; i < magnitudes.length; i++) {
      if (magnitudes[i] > magnitudes[maxIdx]) maxIdx = i;
    }
    return frequencies[maxIdx] || 0;
  }
}
