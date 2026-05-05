import { eventBus } from '../utils/EventBus.js';
import { Events } from '../utils/Constants.js';

export class WebSocketClient {
  constructor() {
    this.ws = null;
    this.isConnected = false;
    this.reconnectTimer = null;
    this.isRecording = false;
  }

  connect() {
    console.log('[WS] Đang kết nối tới Backend (ws://localhost:8080)...');
    this.ws = new WebSocket('ws://localhost:8080');

    this.ws.onopen = () => {
      console.log('[WS] ✅ Đã kết nối tới Backend Server');
      this.isConnected = true;
      // Thông báo cho UI biết
      eventBus.emit('WS_CONNECTED');
    };

    this.ws.onclose = () => {
      console.log('[WS] ❌ Mất kết nối tới Backend');
      this.isConnected = false;
      eventBus.emit('WS_DISCONNECTED');
      
      // Auto reconnect sau 3 giây
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    };

    this.ws.onerror = (error) => {
      console.error('[WS] Lỗi WebSocket:', error);
    };
  }

  startSession(patientName) {
    if (!this.isConnected) return;
    this.isRecording = true;
    this.ws.send(JSON.stringify({ type: 'start_session', patientName: patientName || 'Không rõ' }));
  }

  stopSession() {
    if (!this.isConnected) return;
    this.isRecording = false;
    this.ws.send(JSON.stringify({ type: 'stop_session' }));
  }

  sendFrame(sample) {
    if (!this.isConnected || !this.isRecording) return;

    // Chuyển đối tượng SensorDataSample thành JSON phẳng để gửi
    const frame = {
      frameIndex: sample.frameIndex,
      timestampAbsolute: Date.now(),
      activeMask: 63, // Hardcode 63 (111111) hoặc lấy từ BluetoothService
    };

    // Pack node data
    const segments = [
      'left_upper_arm', 'left_forearm', 'left_wrist',
      'right_upper_arm', 'right_forearm', 'right_wrist'
    ];
    segments.forEach((seg, i) => {
      const r = sample.raw[seg];
      if (r) {
        frame[`n${i+1}`] = { ax: r.ax, ay: r.ay, az: r.az, gx: r.gx, gy: r.gy, gz: r.gz };
      }
    });

    // Joint angles
    if (sample.jointAngles) {
      frame.jointAngles = sample.jointAngles;
    }

    this.ws.send(JSON.stringify({ type: 'frame', frame }));
  }
}
