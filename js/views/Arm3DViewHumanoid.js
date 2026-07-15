/**
 * Arm3DViewHumanoid_v2.js
 * Updated with correct Mixamo bone names (mixamorig:LeftArm format)
 * Compatible with human.glb exported from Blender with Mixamo rig
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// IMPORTANT: SkinnedMesh must be cloned with SkeletonUtils.clone(), NOT
// Object3D.clone(true) — the naive clone keeps the skeleton bound to the
// ORIGINAL bones, so rotating the cloned bones never deforms the mesh.
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { eventBus } from '../utils/EventBus.js';
import { Events } from '../utils/Constants.js';
import { ExerciseAnimator } from './ExerciseAnimator.js';

// =============================================================
// BONE MAP — đúng theo Blender Outliner của model này
// (prefix mixamorig: có dấu hai chấm)
// =============================================================
export const BONE_MAP = {
  // Cánh tay trái
  left_upper_arm:  'mixamorig:LeftArm',
  left_forearm:    'mixamorig:LeftForeArm',
  left_wrist:      'mixamorig:LeftHand',
  // Cánh tay phải
  right_upper_arm: 'mixamorig:RightArm',
  right_forearm:   'mixamorig:RightForeArm',
  right_wrist:     'mixamorig:RightHand',
  // Vai (dùng cho shoulder exercises — cho chuyển động tự nhiên hơn)
  left_shoulder:   'mixamorig:LeftShoulder',
  right_shoulder:  'mixamorig:RightShoulder',
  // Thân (tùy chịn, dùng cho full-body feedback)
  spine:           'mixamorig:Spine',
  hips:            'mixamorig:Hips',
};

/**
 * Normalize a bone name for tolerant matching: lowercase, drop the "mixamorig"
 * prefix, and remove any non-alphanumeric chars. So "mixamorig:LeftArm",
 * "mixamorigLeftArm" and "mixamorig_LeftArm" all become "leftarm".
 * (GLTFLoader sanitizes ':' out of node names, which broke exact matching.)
 */
export function normalizeBoneName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .replace(/^mixamorig/, '');
}

export class Arm3DViewHumanoid {
  /**
   * @param {string} containerId
   * @param {Object} options
   * @param {string} [options.modelUrl='assets/models/human.glb']
   * @param {Object} [options.boneMap] - override BONE_MAP nếu cần
   */
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.modelUrl = options.modelUrl || 'assets/models/human.glb';
    this.boneMap = options.boneMap || BONE_MAP;

    this.container = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Model thực (skin)
    this.realModel = null;
    // Model hướng dẫn (xanh lá bán trong suốt)
    this.guideModel = null;

    /** @type {Object<string, THREE.Bone>} segment -> bone (real) */
    this.bones = {};
    /** @type {Object<string, THREE.Bone>} segment -> bone (guide) */
    this.guideBones = {};
    /** @type {Object<string, THREE.Quaternion>} rest pose — clone trước mọi animation */
    this.restQuaternions = {};
    /** @type {Object<string, THREE.Quaternion>} zero-reference cho IMU */
    this.zeroOffsets = {};

    /** @type {ExerciseAnimator|null} guide model animator */
    this.animator = null;
    /** @type {ExerciseAnimator|null} patient model poser (drives from joint angles) */
    this.realPoser = null;

    this.animationId = null;
    this.isRunning = false;
    this._unsub = [];
  }

  async init() {
    this.container = document.getElementById(this.containerId);
    if (!this.container) {
      console.error(`[Arm3DViewHumanoid] Container #${this.containerId} not found`);
      return;
    }

    this._setupScene();
    this._setupCamera();
    this._setupRenderer();
    this._setupLights();
    this._setupControls();
    this._addLabels();

    await this._loadModels();

    // If the GLB failed to load, throw so the caller falls back to the
    // simple cylinder model instead of showing an empty scene.
    if (!this.realModel) {
      throw new Error('[Arm3DViewHumanoid] Model failed to load');
    }

    // Warn if the rig had no matching bones (model won't move)
    if (Object.keys(this.bones).length === 0) {
      console.warn('[Arm3DViewHumanoid] No bones matched BONE_MAP — check bone names with window.__arm3d.listBones()');
    }

    // Khởi tạo ExerciseAnimator cho guide model
    if (this.guideModel) {
      this.animator = new ExerciseAnimator(this.guideModel, this.boneMap);
    }
    // Poser cho model THỰC (bệnh nhân): dùng CÙNG cơ chế tư thế giải phẫu như guide
    // → model NGHỈ ở tư thế "đứng nghiêm, tay duỗi xuống" (không phải chữ T) và được
    // lái bằng GÓC KHỚP (đã hiệu chuẩn = 0 ở tư thế trung tính) thay vì orientation thô.
    if (this.realModel) {
      this.realPoser = new ExerciseAnimator(this.realModel, this.boneMap);
    }

    this.isRunning = true;
    this._animate();

    // Subscribe events
    this._unsub.push(
      eventBus.on(Events.PROCESSED_DATA_READY, (sample) => this._updateRealModel(sample))
    );
    this._unsub.push(
      eventBus.on(Events.EXERCISE_GUIDE_START, ({ key, name }) => {
        this._setExerciseLabel(name || (this.animator?.exerciseName(key)) || 'Bài tập');
        this.animator?.start(key, {
          repDurationMs: 4000,
          onFeedback: (msg, zone) => {
            eventBus.emit('EXERCISE_FEEDBACK', { msg, zone });
          },
          onRepComplete: (count) => {
            eventBus.emit('EXERCISE_REP_COMPLETE', { count });
          }
        });
      })
    );
    this._unsub.push(
      eventBus.on(Events.EXERCISE_GUIDE_STOP, () => {
        this.animator?.stop();
        this._setExerciseLabel(null);
      })
    );

    window.addEventListener('resize', this._onResize);

    // Expose to console for debugging
    window.__arm3d = this;
    console.log('[Arm3DViewHumanoid] Ready. Bones mapped:', Object.keys(this.bones));
  }

  // ----------------------------------------------------------
  // SCENE SETUP
  // ----------------------------------------------------------

  _setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0f1419);
    // Grid
    const grid = new THREE.GridHelper(5, 10, 0x334155, 0x1e293b);
    this.scene.add(grid);
  }

  _setupCamera() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || 600;
    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    // Pulled back to frame both models (now 2.4 units apart) with arms raised
    this.camera.position.set(0, 1.3, 5.2);
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(
      this.container.clientWidth,
      this.container.clientHeight || 600
    );
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.container.appendChild(this.renderer.domElement);
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x6366f1, 0.5);
    fill.position.set(-3, 2, -2);
    this.scene.add(fill);
  }

  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.0, 0);
    this.controls.enableDamping = true;
    this.controls.minDistance = 1;
    this.controls.maxDistance = 12;
    this.controls.update();
  }

  // ----------------------------------------------------------
  // MODEL LOADING
  // ----------------------------------------------------------

  async _loadModels() {
    const loader = new GLTFLoader();

    const gltf = await new Promise((resolve, reject) => {
      loader.load(this.modelUrl, resolve, undefined, reject);
    }).catch(err => {
      console.error('[Arm3DViewHumanoid] Failed to load model:', err);
      return null;
    });

    if (!gltf) return;

    // --- REAL MODEL (skin color, right side) — driven by the patient's IMU ---
    // Spread far enough apart that fully-abducted arms never touch (arm reach
    // from the body centre ≈ 0.8 units, so >2.0 of total separation is needed).
    this.realModel = cloneSkinned(gltf.scene);
    this.realModel.position.set(1.2, 0, 0);
    this._applyMaterial(this.realModel, new THREE.MeshStandardMaterial({
      color: 0xc68642,
      roughness: 0.8,
      metalness: 0.0,
    }));
    this.scene.add(this.realModel);
    this._mapBones(this.realModel, this.bones, this.restQuaternions);

    // --- GUIDE MODEL (semi-transparent green, left side) — plays the standard motion ---
    this.guideModel = cloneSkinned(gltf.scene);
    this.guideModel.position.set(-1.2, 0, 0);
    this._applyMaterial(this.guideModel, new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.6,
      metalness: 0.0,
      transparent: true,
      opacity: 0.75,
    }));
    this.scene.add(this.guideModel);
    this._mapBones(this.guideModel, this.guideBones, {});

    console.log('[Arm3DViewHumanoid] Loaded. Real bones:', Object.keys(this.bones));
  }

  _applyMaterial(model, mat) {
    model.traverse((obj) => {
      if (obj.isMesh) {
        obj.material = mat;
        obj.castShadow = true;
      }
    });
  }

  /**
   * Traverse model → map tên xương theo boneMap
   * @param {THREE.Object3D} model
   * @param {Object} bonesOut - output: { segment: bone }
   * @param {Object} restOut  - output: { segment: quaternion }
   */
  _mapBones(model, bonesOut, restOut) {
    // Match by NORMALIZED name. GLTFLoader sanitizes node names (e.g. strips the
    // ':' in "mixamorig:LeftArm" → "mixamorigLeftArm"), so an exact string
    // compare against the boneMap fails and no bones map → model stays frozen.
    const wanted = {}; // normalized bone name -> segment
    for (const [seg, boneName] of Object.entries(this.boneMap)) {
      wanted[normalizeBoneName(boneName)] = seg;
    }
    model.traverse((obj) => {
      if (!obj.isBone) return;
      const seg = wanted[normalizeBoneName(obj.name)];
      if (seg && !bonesOut[seg]) {
        bonesOut[seg] = obj;
        restOut[seg] = obj.quaternion.clone();
      }
    });
  }

  // ----------------------------------------------------------
  // REAL MODEL: Cập nhật theo dữ liệu IMU
  // ----------------------------------------------------------

  /**
   * Public: pose the humanoid from one sample (offline replay/scrubbing),
   * driven directly instead of via the live PROCESSED_DATA_READY stream.
   * @param {{jointAngles: Object}} sample
   */
  poseFromSample(sample) {
    if (sample && sample.jointAngles) this._updateRealModel(sample);
  }

  /**
   * Drive the patient model from anatomical JOINT ANGLES via the SAME poser as
   * the guide (ExerciseAnimator.poseFromAngles). Vì cả hai model dùng chung quy
   * ước giải phẫu (flexion = ra trước, abduction = sang bên, 0° = đứng nghiêm
   * tay xuôi — fusion đã zero tại tư thế hiệu chuẩn), bệnh nhân và mẫu luôn
   * chuyển động CÙNG CHIỀU — hết lỗi quay ngược ra sau của đường quaternion thô.
   *
   * Cảm biến thứ 3 gắn Ở CỔ TAY (đầu xa cẳng tay), KHÔNG ở bàn tay → không đo
   * được gập bàn tay; "chuyển động cổ tay" = xoay sấp/ngửa cẳng tay (proSup).
   * Bàn tay model giữ cứng theo cẳng tay (relaxHand trong poser).
   */
  _updateRealModel(sample) {
    const j = sample && sample.jointAngles;
    if (!j || !this.realPoser) return;
    // Nếu một chuyển động bị NGƯỢC trên phần cứng của bạn, đổi dấu đúng dòng đó.
    this.realPoser.poseFromAngles({
      lFlex:   j.leftShoulderFlexion    || 0,
      lAbd:    j.leftShoulderAbduction  || 0,
      lElbow:  j.leftElbowFlexion       || 0,
      lProSup: j.leftForearmProSup      || 0,
      rFlex:   j.rightShoulderFlexion   || 0,
      rAbd:    j.rightShoulderAbduction || 0,
      rElbow:  j.rightElbowFlexion      || 0,
      rProSup: j.rightForearmProSup     || 0,
    }, 0.35);
  }

  /**
   * No-op kept for API compatibility. The model is now driven by joint angles
   * that the sensor fusion already zeroes at the calibrated neutral pose, so no
   * separate per-bone zero-reference is needed here.
   */
  calibrateZero(_sample) { /* joint angles are pre-zeroed by the fusion */ }

  // ----------------------------------------------------------
  // ANIMATION LOOP
  // ----------------------------------------------------------

  _animate = () => {
    if (!this.isRunning) return;
    this.animationId = requestAnimationFrame(this._animate);
    // Cập nhật guide animation
    this.animator?.update(performance.now());
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  };

  _onResize = () => {
    if (!this.container || !this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  // ----------------------------------------------------------
  // ON-SCREEN LABELS (HTML overlays on the canvas container)
  // ----------------------------------------------------------

  _addLabels() {
    if (!this.container) return;
    // container is position:relative (see arm3d-styles.css)
    const guide = document.createElement('div');
    guide.className = 'arm3d-label arm3d-label-guide';
    guide.innerHTML = '<span class="label-dot guide-dot"></span>Mẫu hướng dẫn';

    const user = document.createElement('div');
    user.className = 'arm3d-label arm3d-label-user';
    user.innerHTML = '<span class="label-dot user-dot"></span>Bệnh nhân (bạn)';

    const ex = document.createElement('div');
    ex.className = 'arm3d-label arm3d-label-exercise';
    ex.id = 'arm3d-ex-label';
    ex.style.display = 'none';

    this.container.appendChild(guide);
    this.container.appendChild(user);
    this.container.appendChild(ex);
    this._labelEls = [guide, user, ex];
    this._exLabel = ex;
  }

  /** Show/hide the current exercise name at the bottom of the scene. */
  _setExerciseLabel(name) {
    if (!this._exLabel) return;
    if (name) {
      this._exLabel.textContent = 'Bài tập: ' + name;
      this._exLabel.style.display = '';
    } else {
      this._exLabel.style.display = 'none';
    }
  }

  // ----------------------------------------------------------
  // UTILITIES
  // ----------------------------------------------------------

  /**
   * In tất cả tên xương trong real model.
   * Gọi từ console: window.__arm3d.listBones()
   */
  listBones() {
    const names = [];
    this.realModel?.traverse((o) => { if (o.isBone) names.push(o.name); });
    console.table(names);
    return names;
  }

  /**
   * Preview exercise tại t=0..1 (debug không cần chạy animation)
   * Ví dụ: window.__arm3d.previewAtT('shoulder_flexion', 0.5)
   */
  previewAtT(exerciseKey, t) {
    this.animator?.previewAtT(exerciseKey, t);
  }

  /**
   * Cleanup — gọi khi navigate khỏi trang 3D
   */
  destroy() {
    this.isRunning = false;
    if (this.animationId) cancelAnimationFrame(this.animationId);
    this._unsub.forEach(fn => fn?.());
    this._unsub = [];
    (this._labelEls || []).forEach(el => el.remove());
    this._labelEls = [];
    window.removeEventListener('resize', this._onResize);
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
    }
    if (window.__arm3d === this) delete window.__arm3d;
  }
}
