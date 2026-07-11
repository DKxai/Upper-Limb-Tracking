/**
 * ChartView - Chart.js instance factory and manager
 * Creates and updates all chart instances with consistent styling.
 */

import { CHART_CONFIG } from '../utils/Constants.js';

/**
 * Global plugin for the clinical replay: draws a synchronized time cursor
 * (vertical line), spike markers along the bottom, and a highlighted point on
 * the phase portrait. Charts opt in by setting `$cursorFrac` / `$spikeFracs` /
 * `$cursorPoint` on the instance; it no-ops otherwise.
 */
const ClinicalCursorPlugin = {
  id: 'clinicalCursor',
  afterDraw(chart) {
    const area = chart.chartArea;
    if (!area) return;
    const ctx = chart.ctx;

    // Spike markers: small red triangles at the bottom of the plot
    const spikes = chart.$spikeFracs;
    if (Array.isArray(spikes) && spikes.length) {
      ctx.save();
      ctx.fillStyle = 'rgba(239,68,68,0.85)';
      for (const f of spikes) {
        const x = area.left + f * (area.right - area.left);
        ctx.beginPath();
        ctx.moveTo(x, area.bottom - 8);
        ctx.lineTo(x - 4, area.bottom);
        ctx.lineTo(x + 4, area.bottom);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    // Time cursor (line/bar charts)
    const f = chart.$cursorFrac;
    if (typeof f === 'number' && f >= 0) {
      const x = area.left + f * (area.right - area.left);
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(x, area.top);
      ctx.lineTo(x, area.bottom);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = 'rgba(56,189,248,0.95)';
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.restore();
    }

    // Cursor point in data space (phase portrait)
    const p = chart.$cursorPoint;
    if (p && chart.scales.x && chart.scales.y) {
      const px = chart.scales.x.getPixelForValue(p.x);
      const py = chart.scales.y.getPixelForValue(p.y);
      if (!isNaN(px) && !isNaN(py)) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56,189,248,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  },
};
if (typeof Chart !== 'undefined') Chart.register(ClinicalCursorPlugin);

/**
 * Read the current theme's chart colors from CSS custom properties so charts
 * follow light/dark switching. Falls back to dark defaults if unset.
 */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => {
    const val = cs.getPropertyValue(name).trim();
    return val || fallback;
  };
  return {
    grid: v('--chart-grid', CHART_CONFIG.GRID_COLOR),
    tick: v('--chart-tick', CHART_CONFIG.TICK_COLOR),
    text: v('--chart-text', '#aab4c8'),
    primary: v('--color-text-primary', '#f1f5f9'),
    tooltipBg: v('--chart-tooltip-bg', '#1b2540'),
    accent: v('--color-accent-primary', '#6366f1'),
  };
}

// Build Chart.js default options using the *current* theme colors.
function buildDefaults() {
  const t = themeColors();
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: CHART_CONFIG.ANIMATION_DURATION },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: t.text,
          font: { family: CHART_CONFIG.FONT_FAMILY, size: CHART_CONFIG.FONT_SIZE },
          boxWidth: 12,
          boxHeight: 2,
          padding: 12,
          usePointStyle: false,
        },
      },
      tooltip: {
        backgroundColor: t.tooltipBg,
        titleColor: t.primary,
        bodyColor: t.text,
        borderColor: t.accent,
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
        titleFont: { family: CHART_CONFIG.FONT_FAMILY, size: 12, weight: '600' },
        bodyFont: { family: "'JetBrains Mono', monospace", size: 11 },
        displayColors: true,
        boxWidth: 8,
        boxHeight: 8,
        boxPadding: 4,
      },
    },
    scales: {
      x: {
        grid: { color: t.grid, drawBorder: false },
        ticks: {
          color: t.tick,
          font: { family: CHART_CONFIG.FONT_FAMILY, size: 10 },
          maxTicksLimit: 10,
          maxRotation: 0,
        },
        border: { display: false },
      },
      y: {
        grid: { color: t.grid, drawBorder: false },
        ticks: {
          color: t.tick,
          font: { family: CHART_CONFIG.FONT_FAMILY, size: 10 },
          maxTicksLimit: 6,
        },
        border: { display: false },
      },
    },
  };
}

export class ChartView {
  constructor() {
    /** @type {Map<string, Chart>} */
    this._charts = new Map();
  }

  /**
   * Create a line chart
   * @param {string} id - Chart ID (matches canvas element data-chart-id)
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options - Override options
   * @returns {Chart}
   */
  createLineChart(id, canvas, options = {}) {
    if (this._charts.has(id)) {
      this._charts.get(id).destroy();
    }
    const CHART_DEFAULTS = buildDefaults();

    const config = {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: this._mergeOptions({
        ...CHART_DEFAULTS,
        elements: {
          line: {
            tension: 0.2,
            borderWidth: CHART_CONFIG.LINE_WIDTH,
            fill: false,
          },
          point: {
            radius: CHART_CONFIG.POINT_RADIUS,
            hoverRadius: 4,
            hoverBorderWidth: 2,
          },
        },
      }, options),
    };

    const chart = new Chart(canvas, config);
    this._charts.set(id, chart);
    return chart;
  }

  /**
   * Create a bar chart (for ROM comparison)
   * @param {string} id
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @returns {Chart}
   */
  createBarChart(id, canvas, options = {}) {
    if (this._charts.has(id)) {
      this._charts.get(id).destroy();
    }
    const CHART_DEFAULTS = buildDefaults();

    const config = {
      type: 'bar',
      data: { labels: [], datasets: [] },
      options: this._mergeOptions({
        ...CHART_DEFAULTS,
        elements: {
          bar: { borderRadius: 6, borderSkipped: false },
        },
        scales: {
          ...CHART_DEFAULTS.scales,
          x: {
            ...CHART_DEFAULTS.scales.x,
            ticks: {
              ...CHART_DEFAULTS.scales.x.ticks,
              maxRotation: 0,
              autoSkip: false,
            },
          },
        },
      }, options),
    };

    const chart = new Chart(canvas, config);
    this._charts.set(id, chart);
    return chart;
  }

  /**
   * Create a scatter chart (for trajectory)
   * @param {string} id
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @returns {Chart}
   */
  createScatterChart(id, canvas, options = {}) {
    if (this._charts.has(id)) {
      this._charts.get(id).destroy();
    }
    const CHART_DEFAULTS = buildDefaults();

    const config = {
      type: 'scatter',
      data: { datasets: [] },
      options: this._mergeOptions({
        ...CHART_DEFAULTS,
        elements: {
          point: { radius: 1, hoverRadius: 4 },
          line: { borderWidth: 1.5, tension: 0.1 },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
          legend: { ...CHART_DEFAULTS.plugins.legend, display: true },
        },
      }, options),
    };

    const chart = new Chart(canvas, config);
    this._charts.set(id, chart);
    return chart;
  }

  /**
   * Create a radar chart (for ROM radar)
   * @param {string} id
   * @param {HTMLCanvasElement} canvas
   * @param {Object} options
   * @returns {Chart}
   */
  createRadarChart(id, canvas, options = {}) {
    if (this._charts.has(id)) {
      this._charts.get(id).destroy();
    }
    const CHART_DEFAULTS = buildDefaults();
    const t = themeColors();

    const config = {
      type: 'radar',
      data: { labels: [], datasets: [] },
      options: this._mergeOptions({
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          r: {
            grid: { color: t.grid },
            angleLines: { color: t.grid },
            ticks: {
              color: t.tick,
              backdropColor: 'transparent',
              font: { size: 9 },
            },
            pointLabels: {
              color: t.text,
              font: { family: CHART_CONFIG.FONT_FAMILY, size: 10 },
            },
          },
        },
        plugins: {
          ...CHART_DEFAULTS.plugins,
        },
      }, options),
    };

    const chart = new Chart(canvas, config);
    this._charts.set(id, chart);
    return chart;
  }

  /**
   * Update a chart with new data
   * @param {string} id
   * @param {{ labels?: any[], datasets: Object[] }} data
   */
  updateChart(id, data) {
    const chart = this._charts.get(id);
    if (!chart) return;

    if (data.labels) {
      chart.data.labels = data.labels;
    }

    // Style props that a data generator may change between updates (e.g. when the
    // clinical joint or selected rep changes). Refresh them on existing datasets
    // so stale closures/colors don't linger from a previous render.
    const REFRESH_KEYS = ['borderColor', 'backgroundColor', 'segment', 'showLine',
      'borderDash', 'borderWidth', 'pointRadius', 'pointStyle', 'type'];

    // Update datasets
    for (let i = 0; i < data.datasets.length; i++) {
      if (chart.data.datasets[i]) {
        const cur = chart.data.datasets[i];
        cur.data = data.datasets[i].data;
        if (data.datasets[i].label) cur.label = data.datasets[i].label;
        for (const k of REFRESH_KEYS) {
          if (k in data.datasets[i]) cur[k] = data.datasets[i][k];
        }
      } else {
        // Apply default line styling
        const ds = {
          ...data.datasets[i],
          borderWidth: data.datasets[i].borderWidth || CHART_CONFIG.LINE_WIDTH,
          pointRadius: data.datasets[i].pointRadius ?? CHART_CONFIG.POINT_RADIUS,
          tension: data.datasets[i].tension ?? 0.2,
          fill: data.datasets[i].fill ?? false,
        };
        chart.data.datasets.push(ds);
      }
    }

    // Remove extra datasets
    while (chart.data.datasets.length > data.datasets.length) {
      chart.data.datasets.pop();
    }

    chart.update('none'); // 'none' = no animation for real-time performance
  }

  /**
   * Get a chart instance
   * @param {string} id
   * @returns {Chart|undefined}
   */
  getChart(id) {
    return this._charts.get(id);
  }

  /** Set the synchronized time cursor (0..1 across the plot, or null to clear). */
  setTimeCursor(id, frac) {
    const c = this._charts.get(id);
    if (!c) return;
    c.$cursorFrac = frac;
    c.draw();
  }

  /** Set the phase-portrait cursor point in data coords ({x,y}, or null). */
  setPointCursor(id, point) {
    const c = this._charts.get(id);
    if (!c) return;
    c.$cursorPoint = point;
    c.draw();
  }

  /** Set spike markers (array of 0..1 fractions) along the bottom of a chart. */
  setSpikeMarkers(id, fracs) {
    const c = this._charts.get(id);
    if (!c) return;
    c.$spikeFracs = fracs;
    c.draw();
  }

  /**
   * Destroy a chart
   * @param {string} id
   */
  destroyChart(id) {
    const chart = this._charts.get(id);
    if (chart) {
      chart.destroy();
      this._charts.delete(id);
    }
  }

  /**
   * Destroy all charts
   */
  destroyAll() {
    this._charts.forEach(chart => chart.destroy());
    this._charts.clear();
  }

  /**
   * Resize all charts
   */
  resizeAll() {
    this._charts.forEach(chart => chart.resize());
  }

  /**
   * Deep merge options
   * @private
   */
  _mergeOptions(defaults, overrides) {
    const result = { ...defaults };
    for (const key of Object.keys(overrides)) {
      if (overrides[key] && typeof overrides[key] === 'object' && !Array.isArray(overrides[key])) {
        result[key] = this._mergeOptions(result[key] || {}, overrides[key]);
      } else {
        result[key] = overrides[key];
      }
    }
    return result;
  }
}
