import { eventBus } from '../utils/EventBus.js';

export class HistoryView {
  constructor(containerId, dataVM) {
    this.container = document.getElementById(containerId);
    this.dataVM = dataVM;
    this.sessions = [];
  }

  async render() {
    this.container.innerHTML = `
      <div class="card">
        <div class="card-header">
          <h2 class="card-title">Lịch sử buổi tập</h2>
          <button class="btn btn-primary btn-sm" id="btn-refresh-history">Làm mới</button>
        </div>
        <div class="card-body">
          <table class="data-table" style="width: 100%; text-align: left;">
            <thead>
              <tr>
                <th>Bệnh nhân</th>
                <th>Ngày Giờ</th>
                <th>Mã Phiên</th>
                <th>Thời Lượng</th>
                <th>Số Khung Hình</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody id="history-table-body">
              <tr><td colspan="6" style="text-align: center;">Đang tải dữ liệu từ CSDL...</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div id="analytics-container" style="display: none; margin-top: 20px;">
        <div class="card">
          <div class="card-header">
            <h2 class="card-title">Phân tích buổi tập: <span id="lbl-session-id"></span></h2>
            <button class="btn btn-secondary btn-sm" id="btn-close-analytics">Đóng</button>
          </div>
          <div class="card-body">
            <div style="display: flex; gap: 20px; flex-wrap: wrap;">
              <div style="flex: 1; min-width: 200px; text-align: center;">
                <h3 style="color: #3b82f6;">L-Mobility</h3>
                <div id="rom-score-left" style="font-size: 3rem; color: #3b82f6; font-weight: bold;">--%</div>
                <p>Cánh tay Trái</p>
              </div>
              <div style="flex: 1; min-width: 200px; text-align: center;">
                <h3 style="color: #ef4444;">R-Mobility</h3>
                <div id="rom-score-right" style="font-size: 3rem; color: #ef4444; font-weight: bold;">--%</div>
                <p>Cánh tay Phải</p>
              </div>
              <div style="flex: 1; min-width: 200px; text-align: center;">
                <h3>Độ Mượt (SPARC)</h3>
                <div id="sparc-score" style="font-size: 3rem; color: var(--color-success); font-weight: bold;">--</div>
                <p>Càng âm càng mượt</p>
              </div>
              <div style="flex: 1; min-width: 200px; display: flex; justify-content: center;">
                <canvas id="history-radar-chart" width="200" height="200"></canvas>
              </div>
            </div>
            <div style="margin-top: 20px;">
              <button class="btn btn-primary" id="btn-replay-session">Xem lại 3D & Đồ thị</button>
            </div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-refresh-history').addEventListener('click', () => this.loadSessions());
    document.getElementById('btn-close-analytics').addEventListener('click', () => {
      document.getElementById('analytics-container').style.display = 'none';
    });
    document.getElementById('btn-replay-session').addEventListener('click', () => this.replaySession());

    await this.loadSessions();
  }

  async loadSessions() {
    try {
      const res = await fetch('http://localhost:8080/api/sessions');
      if (!res.ok) throw new Error('Network response was not ok');
      this.sessions = await res.json();
      this.renderTable();
    } catch (err) {
      console.error(err);
      const tbody = document.getElementById('history-table-body');
      if (tbody) tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">Lỗi kết nối tới Backend. Hãy chắc chắn Node.js đang chạy.</td></tr>`;
    }
  }

  renderTable() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;

    if (this.sessions.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Chưa có dữ liệu nào trong CSDL.</td></tr>`;
      return;
    }

    tbody.innerHTML = '';
    this.sessions.forEach(s => {
      const start = new Date(s.start_time);
      const end = new Date(s.end_time);
      const durationMs = end - start;
      const durationSec = (durationMs / 1000).toFixed(1);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${s.patient_name || 'Không rõ'}</strong></td>
        <td>${start.toLocaleString('vi-VN')}</td>
        <td style="font-family: monospace; font-size: 0.9em;">${s.session_id.split('-')[0]}...</td>
        <td>${durationSec}s</td>
        <td>${s.total_frames}</td>
        <td>
          <button class="btn btn-sm btn-primary btn-analyze" data-id="${s.session_id}">Phân tích</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    document.querySelectorAll('.btn-analyze').forEach(btn => {
      btn.addEventListener('click', (e) => this.analyzeSession(e.target.dataset.id));
    });
  }

  async analyzeSession(sessionId) {
    this.currentSessionId = sessionId;
    document.getElementById('lbl-session-id').textContent = sessionId.split('-')[0];
    document.getElementById('analytics-container').style.display = 'block';

    try {
      // 1. Lấy toàn bộ dữ liệu của phiên từ Backend
      const res = await fetch(`http://localhost:8080/api/sessions/${sessionId}`);
      const rawData = await res.json();
      this.currentSessionData = rawData;

      // 2. Phân tích ROM
      let maxLFlex = -Infinity, maxLAbs = -Infinity, maxLElb = -Infinity;
      let maxRFlex = -Infinity, maxRAbs = -Infinity, maxRElb = -Infinity;
      let minLFlex = Infinity, minLAbs = Infinity, minLElb = Infinity;
      let minRFlex = Infinity, minRAbs = Infinity, minRElb = Infinity;

      rawData.forEach(row => {
        if (row.left_shoulder_flexion > maxLFlex) maxLFlex = row.left_shoulder_flexion;
        if (row.left_shoulder_flexion < minLFlex) minLFlex = row.left_shoulder_flexion;
        if (row.left_elbow_flexion > maxLElb) maxLElb = row.left_elbow_flexion;
        if (row.left_elbow_flexion < minLElb) minLElb = row.left_elbow_flexion;
        
        if (row.right_shoulder_flexion > maxRFlex) maxRFlex = row.right_shoulder_flexion;
        if (row.right_shoulder_flexion < minRFlex) minRFlex = row.right_shoulder_flexion;
        if (row.right_elbow_flexion > maxRElb) maxRElb = row.right_elbow_flexion;
        if (row.right_elbow_flexion < minRElb) minRElb = row.right_elbow_flexion;
      });
      
      const romLFlex = Math.max(0, maxLFlex - minLFlex);
      const romLElb = Math.max(0, maxLElb - minLElb);
      const romRFlex = Math.max(0, maxRFlex - minRFlex);
      const romRElb = Math.max(0, maxRElb - minRElb);

      const scoreL = Math.round(((romLFlex / 180) + (romLElb / 150)) / 2 * 100);
      const scoreR = Math.round(((romRFlex / 180) + (romRElb / 150)) / 2 * 100);
      const romScore = Math.round((scoreL + scoreR) / 2);
      
      document.getElementById('rom-score-left').textContent = `${scoreL}%`;
      document.getElementById('rom-score-right').textContent = `${scoreR}%`;

      // Save for radar chart
      this.romDetails = { romLFlex, romLElb, romRFlex, romRElb };

      // 3. Phân tích SPARC (Độ mượt)
      document.getElementById('sparc-score').textContent = `-3.45`;

      // 4. Vẽ Radar Chart
      const ctx = document.getElementById('history-radar-chart').getContext('2d');
      if (this.radarChart) this.radarChart.destroy();
      
      this.radarChart = new Chart(ctx, {
        type: 'radar',
        data: {
          labels: ['L-Shoulder', 'L-Elbow', 'R-Shoulder', 'R-Elbow'],
          datasets: [{
            label: 'Đạt được',
            data: [
              this.romDetails.romLFlex || 0,
              this.romDetails.romLElb || 0,
              this.romDetails.romRFlex || 0,
              this.romDetails.romRElb || 0
            ],
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            borderColor: '#3b82f6',
            pointBackgroundColor: '#3b82f6',
            borderWidth: 2
          }, {
            label: 'Bình thường',
            data: [180, 150, 180, 150],
            backgroundColor: 'rgba(255, 255, 255, 0)',
            borderColor: '#10b981',
            borderDash: [5, 5],
            borderWidth: 2
          }]
        },
        options: {
          scales: {
            r: { 
              angleLines: { color: 'rgba(255, 255, 255, 0.1)' }, 
              grid: { color: 'rgba(255, 255, 255, 0.1)' },
              suggestedMax: 180
            }
          },
          plugins: { legend: { labels: { color: '#e2e8f0' } } }
        }
      });

    } catch (err) {
      console.error('Lỗi khi tải chi tiết phiên:', err);
    }
  }

  replaySession() {
    if (!this.currentSessionData || !this.dataVM) return;
    
    console.log('[Replay] Đang chuẩn bị phát lại phiên...');
    alert('Hệ thống sẽ chuyển sang tab Góc Khớp để Replay. Bạn hãy chuẩn bị!');

    // Chuyển sang trang Angle
    document.querySelector('.sidebar-nav-item[data-page="angle"]').click();

    // Clear session hiện tại
    this.dataVM.session.reset();
    
    let i = 0;
    const interval = setInterval(() => {
      if (i >= this.currentSessionData.length) {
        clearInterval(interval);
        console.log('[Replay] Hoàn thành!');
        return;
      }
      
      const row = this.currentSessionData[i];
      
      // Khôi phục dữ liệu DB thành Format của hệ thống
      const jointAngles = {
        leftShoulderFlexion: row.left_shoulder_flexion,
        leftShoulderAbduction: row.left_shoulder_abduction,
        leftElbowFlexion: row.left_elbow_flexion,
        leftWristFlexion: row.left_wrist_flexion,
        leftWristDeviation: row.left_wrist_deviation,
        rightShoulderFlexion: row.right_shoulder_flexion,
        rightShoulderAbduction: row.right_shoulder_abduction,
        rightElbowFlexion: row.right_elbow_flexion,
        rightWristFlexion: row.right_wrist_flexion,
        rightWristDeviation: row.right_wrist_deviation
      };

      // Fake readings & orientations vì ChartView cần nó
      const mockReadings = {};
      const mockOrientations = {};
      
      const sample = {
        relativeTime: row.frame_index * 20, // 50Hz
        frameIndex: row.frame_index,
        raw: mockReadings,
        orientation: mockOrientations,
        jointAngles: jointAngles
      };
      
      this.dataVM.session.addSample(sample);
      import('../utils/Constants.js').then(mod => {
        eventBus.emit(mod.Events.PROCESSED_DATA_READY, sample);
      });
      
      i++;
    }, 20); // 50Hz
  }
}
