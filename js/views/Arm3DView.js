/**
 * Arm3DView - 3D visualization of dual-arm tracking using Three.js
 * Includes a GUIDE ARM that demonstrates correct exercise form with animation.
 * Subscribes to PROCESSED_DATA_READY events and updates the 3D model in real-time.
 */

import { eventBus } from '../utils/EventBus.js';
import { Events, ArmSegment, SEGMENT_COLORS } from '../utils/Constants.js';
import * as THREE from 'three';

// Ánh xạ trục IMU → trục Three.js
const SENSOR_TO_WORLD = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(
    new THREE.Vector3(0, -1, 0),   // IMU X
    new THREE.Vector3(1, 0, 0),    // IMU Y
    new THREE.Vector3(0, 0, 1)     // IMU Z
  )
);

export class Arm3DView {
  constructor(containerId) {
    this.containerId = containerId;
    this.container = null;

    // Three.js objects
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.armModels = {}; // Store mesh objects for each real segment
    this.gridHelper = null;
    this.axesHelper = null;

    // Guide arm objects
    this.guideGroup = null;
    this.guideShoulderPivot = null;
    this.guideElbowPivot = null;
    this.guideWristPivot = null;
    this.guideAnimating = false;
    this.guideTargets = null;
    this.guideAnimStartTime = 0;
    this.guideExerciseName = '';

    // Animation
    this.animationId = null;
    this.isRunning = false;

    // Camera controls
    this.cameraAngle = { theta: Math.PI / 4, phi: Math.PI / 4 };
    this.cameraDistance = 12;
    this.isDragging = false;
    this.lastMouse = { x: 0, y: 0 };

    // Labels
    this._guideLabel = null;
    this._userLabel = null;

    // Event unsubscribers
    this._unsubs = [];
  }

  /**
   * Initialize the 3D scene
   */
  init() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.error(`[Arm3DView] Container #${this.containerId} not found`);
      return;
    }

    // Setup Three.js scene
    this._setupScene();
    this._setupCamera();
    this._setupRenderer();
    this._setupLights();
    this._createArmModels();
    this._createGuideArm();
    this._createLabels();
    this._setupControls();

    // Start animation loop
    this.isRunning = true;
    this._animate();

    // Subscribe to data events
    this._unsubs.push(
      eventBus.on(Events.PROCESSED_DATA_READY, (sample) => {
        this._updateArmPose(sample);
      })
    );

    // Subscribe to exercise guide events
    this._unsubs.push(
      eventBus.on(Events.EXERCISE_GUIDE_START, (data) => {
        this._startGuide(data.targets, data.name);
      })
    );
    this._unsubs.push(
      eventBus.on(Events.EXERCISE_GUIDE_STOP, () => {
        this._stopGuide();
      })
    );

    // Handle window resize
    this._resizeHandler = () => this._onWindowResize();
    window.addEventListener('resize', this._resizeHandler);
  }

  // ═══════════════════════════════════════
  //   SCENE SETUP
  // ═══════════════════════════════════════

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1419);
    this.scene.fog = new THREE.Fog(0x0f1419, 15, 40);

    // Add grid
    this.gridHelper = new THREE.GridHelper(20, 20, 0x334155, 0x1e293b);
    this.scene.add(this.gridHelper);

    // Add axes helper (small, at origin)
    this.axesHelper = new THREE.AxesHelper(2);
    this.scene.add(this.axesHelper);
  }

  _setupCamera() {
    const aspect = this.container.clientWidth / this.container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    this._updateCameraPosition();
    this.camera.lookAt(0, 2, 0);
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);
  }

  _setupLights() {
    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambient);

    // Key light
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.8);
    keyLight.position.set(5, 10, 5);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0x6366f1, 0.3);
    fillLight.position.set(-5, 5, -5);
    this.scene.add(fillLight);

    // Rim light
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(0, 5, -10);
    this.scene.add(rimLight);
  }

  // ═══════════════════════════════════════
  //   REAL ARM MODEL (Sensor Data)
  // ═══════════════════════════════════════

  _createArmModels() {
    const buildArm = (sideStr, offsetX) => {
      const upperKey = ArmSegment[`${sideStr}_UPPER_ARM`];
      const forearmKey = ArmSegment[`${sideStr}_FOREARM`];
      const wristKey = ArmSegment[`${sideStr}_WRIST`];

      const createSegment = (key, length) => {
        const group = new THREE.Group();
        
        const geometry = new THREE.CylinderGeometry(0.15, 0.15, length, 12);
        const material = new THREE.MeshPhongMaterial({
          color: SEGMENT_COLORS[key],
          emissive: SEGMENT_COLORS[key],
          emissiveIntensity: 0.2,
          shininess: 30
        });
        const cylinder = new THREE.Mesh(geometry, material);
        cylinder.position.y = -length / 2; // Pivot at the top
        cylinder.castShadow = true;
        cylinder.receiveShadow = true;
        group.add(cylinder);

        const jointGeometry = new THREE.SphereGeometry(0.2, 16, 16);
        const jointMaterial = new THREE.MeshPhongMaterial({
          color: 0xffffff,
          emissive: SEGMENT_COLORS[key],
          emissiveIntensity: 0.3
        });
        const joint = new THREE.Mesh(jointGeometry, jointMaterial);
        joint.castShadow = true;
        group.add(joint); // Joint at 0,0,0 (pivot point)

        this.armModels[key] = { group, cylinder, joint, length, initialWorldQuat: new THREE.Quaternion() };
        return group;
      };

      const upper = createSegment(upperKey, 3);
      upper.position.set(offsetX, 2, 0); // Root position
      
      const forearm = createSegment(forearmKey, 2.5);
      forearm.position.set(0, -3, 0); // At the bottom of upper arm
      upper.add(forearm);

      const wrist = createSegment(wristKey, 0.8);
      wrist.position.set(0, -2.5, 0); // At the bottom of forearm
      forearm.add(wrist);

      this.scene.add(upper);
    };

    buildArm('LEFT', -2.5);
    buildArm('RIGHT', 2.5);

    // Force matrix update to compute initial world quaternions
    this.scene.updateMatrixWorld(true);
    for (const key of Object.keys(this.armModels)) {
      this.armModels[key].group.getWorldQuaternion(this.armModels[key].initialWorldQuat);
    }
  }

  // ═══════════════════════════════════════
  //   GUIDE ARM MODEL (Exercise Demo)
  // ═══════════════════════════════════════

  _createGuideArm() {
    const guideColor = 0x22c55e; // Green

    const guideMat = (opacity = 0.55) => new THREE.MeshPhongMaterial({
      color: guideColor,
      emissive: guideColor,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity,
      shininess: 60,
      side: THREE.DoubleSide,
    });

    const jointMat = (opacity = 0.7) => new THREE.MeshPhongMaterial({
      color: 0xffffff,
      emissive: guideColor,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity,
      shininess: 80,
    });

    // ── Root group: positioned at shoulder location ──
    this.guideGroup = new THREE.Group();
    this.guideGroup.position.set(-5.5, 5, 0);
    this.guideGroup.visible = false; // Hidden until exercise starts

    // ── Shoulder reference (small plate for anatomical context) ──
    const shoulderPlate = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.25, 0.5),
      guideMat(0.35)
    );
    shoulderPlate.position.y = 0.15;
    this.guideGroup.add(shoulderPlate);

    // ── Shoulder joint sphere ──
    const shoulderJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 16, 16),
      jointMat(0.75)
    );
    this.guideGroup.add(shoulderJoint);

    // ── Shoulder Pivot (rotation point for the whole arm) ──
    this.guideShoulderPivot = new THREE.Group();
    this.guideGroup.add(this.guideShoulderPivot);

    // Upper arm (hanging down from shoulder)
    const upperArm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.14, 3, 12),
      guideMat()
    );
    upperArm.position.y = -1.5; // Center of 3-unit cylinder
    this.guideShoulderPivot.add(upperArm);

    // ── Elbow Pivot (at bottom of upper arm) ──
    this.guideElbowPivot = new THREE.Group();
    this.guideElbowPivot.position.y = -3;
    this.guideShoulderPivot.add(this.guideElbowPivot);

    // Elbow joint sphere
    const elbowJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 16),
      jointMat(0.7)
    );
    this.guideElbowPivot.add(elbowJoint);

    // Forearm
    const forearm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.12, 2.5, 12),
      guideMat()
    );
    forearm.position.y = -1.25;
    this.guideElbowPivot.add(forearm);

    // ── Wrist Pivot (at bottom of forearm) ──
    this.guideWristPivot = new THREE.Group();
    this.guideWristPivot.position.y = -2.5;
    this.guideElbowPivot.add(this.guideWristPivot);

    // Wrist joint sphere
    const wristJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 16, 16),
      jointMat(0.65)
    );
    this.guideWristPivot.add(wristJoint);

    // Hand
    const hand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.08, 0.8, 10),
      guideMat(0.45)
    );
    hand.position.y = -0.4;
    this.guideWristPivot.add(hand);

    // Hand tip sphere
    const handTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 12, 12),
      jointMat(0.5)
    );
    handTip.position.y = -0.8;
    this.guideWristPivot.add(handTip);

    this.scene.add(this.guideGroup);
  }

  // ═══════════════════════════════════════
  //   LABELS (HTML overlays)
  // ═══════════════════════════════════════

  _createLabels() {
    // Guide label
    this._guideLabel = document.createElement('div');
    this._guideLabel.className = 'arm3d-label arm3d-label-guide';
    this._guideLabel.innerHTML = '<span class="label-dot guide-dot"></span> Động tác mẫu';
    this._guideLabel.style.display = 'none';
    this.container.appendChild(this._guideLabel);

    // Exercise name label
    this._exerciseLabel = document.createElement('div');
    this._exerciseLabel.className = 'arm3d-label arm3d-label-exercise';
    this._exerciseLabel.textContent = '';
    this._exerciseLabel.style.display = 'none';
    this.container.appendChild(this._exerciseLabel);

    // User label
    this._userLabel = document.createElement('div');
    this._userLabel.className = 'arm3d-label arm3d-label-user';
    this._userLabel.innerHTML = '<span class="label-dot user-dot"></span> Dữ liệu cảm biến';
    this._userLabel.style.display = 'none';
    this.container.appendChild(this._userLabel);
  }

  _showLabels(exerciseName) {
    if (this._guideLabel) {
      this._guideLabel.style.display = 'flex';
    }
    if (this._userLabel) {
      this._userLabel.style.display = 'flex';
    }
    if (this._exerciseLabel) {
      this._exerciseLabel.textContent = exerciseName || '';
      this._exerciseLabel.style.display = exerciseName ? 'block' : 'none';
    }
  }

  _hideLabels() {
    if (this._guideLabel) this._guideLabel.style.display = 'none';
    if (this._userLabel) this._userLabel.style.display = 'none';
    if (this._exerciseLabel) this._exerciseLabel.style.display = 'none';
  }

  // ═══════════════════════════════════════
  //   GUIDE ARM ANIMATION
  // ═══════════════════════════════════════

  /**
   * Start the guide arm animation for an exercise
   * @param {Object} targets - Exercise target angles, e.g. { leftShoulderFlexion: { min, max, optimal } }
   * @param {string} name - Exercise name for display
   */
  _startGuide(targets, name) {
    this.guideTargets = targets;
    this.guideExerciseName = name || '';
    this.guideAnimating = true;
    this.guideAnimStartTime = Date.now();

    // Reset guide pose
    this.guideShoulderPivot.rotation.set(0, 0, 0);
    this.guideElbowPivot.rotation.set(0, 0, 0);
    this.guideWristPivot.rotation.set(0, 0, 0);

    // Show guide
    this.guideGroup.visible = true;
    this._showLabels(name);

    // Slightly zoom out & shift camera to see both models
    this.cameraDistance = 14;
    this._updateCameraPosition();
  }

  /**
   * Stop the guide arm animation
   */
  _stopGuide() {
    this.guideAnimating = false;
    this.guideTargets = null;
    this.guideGroup.visible = false;
    this._hideLabels();

    // Restore camera
    this.cameraDistance = 12;
    this._updateCameraPosition();
  }

  /**
   * Update guide arm pose each frame based on exercise targets
   * Uses a smooth sine-wave oscillation to mimic a rep cycle
   */
  _updateGuideAnimation() {
    if (!this.guideAnimating || !this.guideTargets) return;

    const elapsed = (Date.now() - this.guideAnimStartTime) / 1000;

    // Smooth oscillation: 0 → 1 → 0 over ~4 seconds per rep
    const repDuration = 4.0; // seconds
    const t = (1 - Math.cos(elapsed * 2 * Math.PI / repDuration)) / 2;

    // Reset rotations each frame
    this.guideShoulderPivot.rotation.set(0, 0, 0);
    this.guideElbowPivot.rotation.set(0, 0, 0);
    this.guideWristPivot.rotation.set(0, 0, 0);

    // Apply target rotations based on exercise type
    for (const [angleName, range] of Object.entries(this.guideTargets)) {
      const targetRad = (range.optimal || 90) * Math.PI / 180;
      const currentRad = targetRad * t;

      if (angleName.includes('ShoulderFlexion')) {
        // Forward raise: rotate around X axis (negative = forward)
        this.guideShoulderPivot.rotation.x = -currentRad;
      } else if (angleName.includes('ShoulderAbduction')) {
        // Side raise: rotate around Z axis
        // Left arm raises to the left (positive Z)
        const direction = angleName.startsWith('left') ? 1 : -1;
        this.guideShoulderPivot.rotation.z = direction * currentRad;
      } else if (angleName.includes('ElbowFlexion')) {
        // Bend elbow: rotate forearm around X axis (positive = bend)
        this.guideElbowPivot.rotation.x = currentRad;
      } else if (angleName.includes('WristFlexion')) {
        this.guideWristPivot.rotation.x = currentRad;
      }
    }

    // Subtle breathing glow effect on guide materials
    const glowPhase = (Math.sin(elapsed * 3) + 1) / 2;
    this.guideGroup.traverse((child) => {
      if (child.isMesh && child.material && child.material.emissiveIntensity !== undefined) {
        child.material.emissiveIntensity = 0.25 + glowPhase * 0.2;
      }
    });
  }

  // ═══════════════════════════════════════
  //   CAMERA CONTROLS
  // ═══════════════════════════════════════

  _setupControls() {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;
      const dx = e.clientX - this.lastMouse.x;
      const dy = e.clientY - this.lastMouse.y;

      this.cameraAngle.theta += dx * 0.005;
      this.cameraAngle.phi = Math.max(0.1, Math.min(Math.PI - 0.1, this.cameraAngle.phi - dy * 0.005));

      this._updateCameraPosition();
      this.lastMouse = { x: e.clientX, y: e.clientY };
    });

    canvas.addEventListener('mouseup', () => {
      this.isDragging = false;
    });

    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cameraDistance = Math.max(5, Math.min(25, this.cameraDistance + e.deltaY * 0.01));
      this._updateCameraPosition();
    });
  }

  _updateCameraPosition() {
    const { theta, phi } = this.cameraAngle;
    const lookAtX = this.guideAnimating ? -1.5 : 0;
    this.camera.position.x = this.cameraDistance * Math.sin(phi) * Math.sin(theta) + lookAtX;
    this.camera.position.y = this.cameraDistance * Math.cos(phi) + 2;
    this.camera.position.z = this.cameraDistance * Math.sin(phi) * Math.cos(theta);
    this.camera.lookAt(lookAtX, 2, 0);
  }

  // ═══════════════════════════════════════
  //   REAL-TIME UPDATE
  // ═══════════════════════════════════════

  /**
   * Public: pose the model from a single sample (for offline replay/scrubbing,
   * driven directly instead of via the live PROCESSED_DATA_READY stream).
   * @param {{orientation: Object}} sample
   */
  poseFromSample(sample) {
    if (sample && (sample.quaternions || sample.orientation)) this._updateArmPose(sample);
  }

  _updateArmPose(sample) {
    const qs = sample && sample.quaternions;
    if (!qs) {
      // Fallback cho chế độ cũ (orientation góc Euler) nếu cần giữ compatibility
      if (sample && sample.orientation) {
        Object.entries(sample.orientation).forEach(([segmentKey, orientation]) => {
          // Wrist đi cứng theo forearm (cảm biến ở cổ tay ≠ bàn tay — xem trên)
          if (segmentKey === ArmSegment.LEFT_WRIST || segmentKey === ArmSegment.RIGHT_WRIST) return;
          const model = this.armModels[segmentKey];
          if (!model || !orientation) return;
          const roll = orientation.roll * Math.PI / 180;
          const pitch = orientation.pitch * Math.PI / 180;
          const yaw = orientation.yaw * Math.PI / 180;
          model.group.rotation.set(pitch, yaw, roll);
        });
      }
      return;
    }

    const inv = SENSOR_TO_WORLD.clone().invert();
    // Cảm biến "cổ tay" gắn ở ĐẦU XA CẲNG TAY (không phải bàn tay) → không lái
    // đốt wrist riêng (nhiễu tương đối forearm↔wrist làm gãy/bẻ cổ tay giả);
    // đốt wrist đi cứng theo forearm.
    const order = [
      ArmSegment.LEFT_UPPER_ARM, ArmSegment.LEFT_FOREARM,
      ArmSegment.RIGHT_UPPER_ARM, ArmSegment.RIGHT_FOREARM
    ];

    for (const seg of order) {
      const q = qs[seg];
      const model = this.armModels[seg];
      if (!q || !model) continue;

      const group = model.group;
      const qImu = new THREE.Quaternion(q[1], q[2], q[3], q[0]);
      const qWorldRot = SENSOR_TO_WORLD.clone().multiply(qImu).multiply(inv);
      const targetWorld = qWorldRot.multiply(model.initialWorldQuat.clone());

      if (group.parent && group.parent !== this.scene) {
        group.parent.updateWorldMatrix(true, false);
        const pq = new THREE.Quaternion();
        group.parent.getWorldQuaternion(pq);
        group.quaternion.slerp(pq.invert().multiply(targetWorld), 0.5);
      } else {
        group.quaternion.slerp(targetWorld, 0.5);
      }
    }
  }

  // ═══════════════════════════════════════
  //   ANIMATION LOOP
  // ═══════════════════════════════════════

  _animate() {
    if (!this.isRunning) return;

    this.animationId = requestAnimationFrame(() => this._animate());

    // Update guide arm animation
    this._updateGuideAnimation();

    this.renderer.render(this.scene, this.camera);
  }

  _onWindowResize() {
    if (!this.container) return;
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  // ═══════════════════════════════════════
  //   CLEANUP
  // ═══════════════════════════════════════

  destroy() {
    this.isRunning = false;
    this._stopGuide();

    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
    }
    this._unsubs.forEach(unsub => unsub());
    this._unsubs = [];

    if (this._resizeHandler) {
      window.removeEventListener('resize', this._resizeHandler);
    }
    // Remove labels
    if (this._guideLabel && this._guideLabel.parentNode) {
      this._guideLabel.parentNode.removeChild(this._guideLabel);
    }
    if (this._userLabel && this._userLabel.parentNode) {
      this._userLabel.parentNode.removeChild(this._userLabel);
    }
    if (this._exerciseLabel && this._exerciseLabel.parentNode) {
      this._exerciseLabel.parentNode.removeChild(this._exerciseLabel);
    }

    if (this.renderer) {
      this.renderer.dispose();
      if (this.container && this.renderer.domElement.parentNode === this.container) {
        this.container.removeChild(this.renderer.domElement);
      }
    }
  }

  reset() {
    Object.values(this.armModels).forEach(model => {
      model.group.rotation.set(0, 0, 0);
    });
    this._stopGuide();
  }
}
