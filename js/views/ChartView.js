/**
 * ChartView - Chart.js instance factory and manager
 * Creates and updates all chart instances with consistent styling.
 */

import { CHART_CONFIG } from '../utils/Constants.js';

// Chart.js default configuration for dark theme
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  animation: { duration: CHART_CONFIG.ANIMATION_DURATION },
  interaction: {
    mode: 'nearest',
    axis: 'x',
    intersect: false,
  },
  plugins: {
    legend: {
      display: true,
      position: 'top',
      align: 'end',
      labels: {
        color: 'rgba(148, 163, 184, 0.8)',
        font: { family: CHART_CONFIG.FONT_FAMILY, size: CHART_CONFIG.FONT_SIZE },
        boxWidth: 12,
        boxHeight: 2,
        padding: 12,
        usePointStyle: false,
      },
    },
    tooltip: {
      backgroundColor: 'rgba(15, 23, 42, 0.95)',
      titleColor: '#f1f5f9',
      bodyColor: '#94a3b8',
      borderColor: 'rgba(99, 102, 241, 0.3)',
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
      grid: {
        color: CHART_CONFIG.GRID_COLOR,
        drawBorder: false,
      },
      ticks: {
        color: CHART_CONFIG.TICK_COLOR,
        font: { family: CHART_CONFIG.FONT_FAMILY, size: 10 },
        maxTicksLimit: 10,
        maxRotation: 0,
      },
      border: { display: false },
    },
    y: {
      grid: {
        color: CHART_CONFIG.GRID_COLOR,
        drawBorder: false,
      },
      ticks: {
        color: CHART_CONFIG.TICK_COLOR,
        font: { family: CHART_CONFIG.FONT_FAMILY, size: 10 },
        maxTicksLimit: 6,
      },
      border: { display: false },
    },
  },
};

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

    const config = {
      type: 'radar',
      data: { labels: [], datasets: [] },
      options: this._mergeOptions({
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        scales: {
          r: {
            grid: { color: CHART_CONFIG.GRID_COLOR },
            angleLines: { color: CHART_CONFIG.GRID_COLOR },
            ticks: {
              color: CHART_CONFIG.TICK_COLOR,
              backdropColor: 'transparent',
              font: { size: 9 },
            },
            pointLabels: {
              color: 'rgba(148, 163, 184, 0.8)',
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

    // Update datasets
    for (let i = 0; i < data.datasets.length; i++) {
      if (chart.data.datasets[i]) {
        chart.data.datasets[i].data = data.datasets[i].data;
        if (data.datasets[i].label) {
          chart.data.datasets[i].label = data.datasets[i].label;
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
