/**
 * ExportService - Export data as CSV, JSON, or chart images
 */

export class ExportService {
  /**
   * Download text content as file
   * @param {string} content
   * @param {string} filename
   * @param {string} mimeType
   */
  static downloadFile(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Export SessionData as CSV
   * @param {import('../models/SessionData.js').SessionData} session
   */
  static exportCSV(session) {
    const csv = session.toCSV();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.downloadFile(csv, `arm_tracking_${timestamp}.csv`, 'text/csv');
  }

  /**
   * Export SessionData as JSON
   * @param {import('../models/SessionData.js').SessionData} session
   */
  static exportJSON(session) {
    const json = JSON.stringify(session.toJSON(), null, 2);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    this.downloadFile(json, `arm_tracking_${timestamp}.json`, 'application/json');
  }

  /**
   * Export a Chart.js chart as PNG image
   * @param {import('chart.js').Chart} chart - Chart.js instance
   * @param {string} filename
   */
  static exportChartPNG(chart, filename = 'chart.png') {
    const url = chart.toBase64Image();
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  /**
   * Copy data to clipboard as tab-separated values
   * @param {import('../models/SessionData.js').SessionData} session
   */
  static async copyToClipboard(session) {
    const csv = session.toCSV().replace(/,/g, '\t');
    try {
      await navigator.clipboard.writeText(csv);
      return true;
    } catch {
      return false;
    }
  }
}
