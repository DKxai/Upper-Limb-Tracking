/**
 * ExerciseAnimator.js
 * 
 * Hệ thống animation hướng dẫn bài tập phục hồi chức năng chuẩn y khoa.
 *
 * NGUN THAM KHẢO LÂM SÀNG:
 * - AAOS (American Academy of Orthopaedic Surgeons) — Normal ROM values
 *   https://orthoportal.aaos.org/
 * - AMA Guides to Evaluation of Permanent Impairment, 6th Ed.
 * - Norkin & White: Measurement of Joint Motion — A Guide to Goniometry, 5th Ed.
 * - Magee: Orthopedic Physical Assessment, 6th Ed.
 * - DASH Outcome Measure (Disabilities of Arm, Shoulder, Hand)
 *
 * CUẨN GONIOMETRY CHUẨN:
 * Shoulder Flexion:   0–180°
 * Shoulder Extension: 0–60°
 * Shoulder Abduction: 0–180°
 * Shoulder IR/ER:     0–70° / 0–90°
 * Elbow Flexion:      0–150°
 * Forearm Pron/Sup:   0–85° / 0–90°
 * Wrist Flexion:      0–80°
 * Wrist Extension:    0–70°
 *
 * KHÔNG dùng sine wave tuỳ tiện. Mỗi exercise là chuỗi
 * KEYFRAME có góc chính xác, duration, và easing.
 */

import * as THREE from 'three';

// ============================================================
// CLÍNICAL EXERCISE LIBRARY
// Góc (degrees) dựa trên AAOS điều chỉnh cho rehabilitation
// Số liệu này là mức đích giai đoạn đầu (conservative), không phải mức tối đa.
// ============================================================
export const CLINICAL_EXERCISES = {

  /**
   * SHOULDER FLEXION
   * Chỉ định: Phục hồi sau phẫu thuật khay vai, cứng khớp vai (frozen shoulder)
   * Reference: AAOS normal = 180°. Rehab target Phase 1 = 90-120°
   * Plane of motion: Sagittal (pitch axis)
   */
  shoulder_flexion: {
    name: 'Gập Vai (Shoulder Flexion)',
    clinicalRef: 'AAOS: 0–180°. Target Phase 1: 0–90°',
    description: 'Nâng cánh tay lên phía trước trong mặt phẳng đứng',
    targetDegrees: 90,
    side: 'bilateral',  // cả hai tay
    reps: 10,
    holdSec: 2,
    /**
     * Keyframes: [t=0..1 (fraction of 1 rep), leftPitch, rightPitch]
     * t=0: rest, t=0.5: peak, t=1: rest
     * pitch dương = cánh tay ra trước (flexion)
     */
    // Một pha nâng đều (0→90°), giữ, rồi một pha hạ đều — tốc độ đồng nhất,
    // không bị giật/tăng tốc giữa chừng. Easing in-out áp cho cả pha.
    keyframes: [
      { t: 0.00, lPitch:  0, rPitch:  0 },  // Tư thế đứng, tay buông
      { t: 0.42, lPitch: 90, rPitch: 90 },  // Nâng đều lên 90° (ngang vai)
      { t: 0.58, lPitch: 90, rPitch: 90 },  // Giữ
      { t: 1.00, lPitch:  0, rPitch:  0 },  // Hạ đều về tư thế đứng
    ],
    feedback: {
      start: 'Bắt đầu nâng cánh tay ra phía trước',
      peak: 'Giữ tư thế, đếm 1-2-3',
      end: 'Hạ cánh tay từ từ xuống',
    }
  },

  /**
   * SHOULDER ABDUCTION
   * Chỉ định: Phục hồi tầm vận động sau bất động, phẫu thuật vai
   * Reference: AAOS normal = 180°. Rehab target Phase 1 = 90°
   * Plane of motion: Frontal (roll axis)
   */
  shoulder_abduction: {
    name: 'Dạng Vai (Shoulder Abduction)',
    clinicalRef: 'AAOS: 0–180°. Target Phase 1: 0–90°',
    description: 'Giơ cánh tay sang hai bên',
    targetDegrees: 90,
    side: 'bilateral',
    reps: 10,
    holdSec: 2,
    /**
     * roll dương = cánh tay dạng sang ngang
     * Lưu ý: A-pose đã có ~30° abduction → offset baked vào keyframe
     */
    keyframes: [
      { t: 0.00, lRoll:  0, rRoll:  0 },
      { t: 0.42, lRoll: 90, rRoll: 90 },  // dạng đều ra ngang vai
      { t: 0.58, lRoll: 90, rRoll: 90 },  // giữ
      { t: 1.00, lRoll:  0, rRoll:  0 },  // hạ đều
    ],
    feedback: {
      start: 'Giơ cánh tay ra hai bên từ từ',
      peak: 'Giữ ngang vai, đếm đến 3',
      end: 'Hạ cánh tay về tư thế ban đầu',
    }
  },

  /**
   * ELBOW FLEXION/EXTENSION
   * Chỉ định: Phục hồi sau gãy xương khuỷu, thay khớp
   * Reference: AAOS normal Flexion = 150°. Rehab target Phase 1 = 90–120°
   * Plane of motion: Sagittal (pitch axis ở forearm relative to upper arm)
   */
  elbow_flexion: {
    name: 'Gập Khuỷu (Elbow Flexion)',
    clinicalRef: 'AAOS: 0–150°. Target Phase 1: 0–120°',
    description: 'Gập và duỗi khuỷu tay cân đối',
    targetDegrees: 120,
    side: 'bilateral',
    reps: 12,
    holdSec: 1,
    // Arm ở bên cạnh người, gấp khuỷu lên
    keyframes: [
      { t: 0.00, lForearmPitch:   0, rForearmPitch:   0 },  // Duỗi thẳng
      { t: 0.42, lForearmPitch: 120, rForearmPitch: 120 },  // Gấp đều lên 120°
      { t: 0.58, lForearmPitch: 120, rForearmPitch: 120 },  // hold
      { t: 1.00, lForearmPitch:   0, rForearmPitch:   0 },  // Duỗi đều
    ],
    // Upper arm: giữ sát người (adduction 0°, slight forward pitch 10°)
    upperArmPitch: 10,
    feedback: {
      start: 'Gập khuỷu tay lên từ từ',
      peak: 'Giữ ở đỉnh, cảm nhận cơ bắp',
      end: 'Trả về thẳng',
    }
  },

  /**
   * PENDULUM (Codman Exercise)
   * Chỉ định: Sau phẫu thuật vai, frozen shoulder giai đoạn đầu
   * Reference: Codman EA, 1934. Thường được chỉ định sớm nhất sau mổ
   * Plane: Circular (small circles, using gravity)
   */
  pendulum: {
    name: 'Con Lắc Codman (Pendulum)',
    clinicalRef: 'Codman 1934, tái bản trong J Shoulder Elbow Surg',
    description: 'Thả lỏng cánh tay, vẽ vòng nhỏ nhờ trọng lực',
    targetDegrees: 30,  // small pendulum ~15-30°
    side: 'unilateral',  // thường 1 bên
    reps: 20,
    holdSec: 0,
    // Circular motion: pitch + roll combination, small amplitude
    keyframes: [
      { t: 0.00,  lPitch:   0, lRoll:   0 },
      { t: 0.25,  lPitch:  20, lRoll:   0 },
      { t: 0.50,  lPitch:   0, lRoll:  20 },
      { t: 0.75,  lPitch: -20, lRoll:   0 },
      { t: 1.00,  lPitch:   0, lRoll:   0 },
    ],
    feedback: {
      start: 'Thả lỏng cánh tay, để trọng lực kéo xuống',
      peak: 'Vẽ vòng nhỏ, KHOONG cố sức',
      end: 'Điều nhị nhàng, không gạt',
    }
  },

  /**
   * WRIST FLEXION/EXTENSION
   * Chỉ định: Phục hồi sau gãy Colles, phẫu thuật cánh tay
   * Reference: AAOS Wrist Flexion = 80°, Extension = 70°
   */
  wrist_flexion: {
    name: 'Gập Cổ Tay (Wrist Flexion/Extension)',
    clinicalRef: 'AAOS: Flex 0–80°, Ext 0–70°',
    description: 'Gập và ngửa cổ tay',
    targetDegrees: 60,
    side: 'bilateral',
    reps: 15,
    holdSec: 1,
    keyframes: [
      { t: 0.00,  lWristPitch:   0, rWristPitch:   0 },
      { t: 0.25,  lWristPitch:  60, rWristPitch:  60 },  // Flex
      { t: 0.35,  lWristPitch:  60, rWristPitch:  60 },  // hold
      { t: 0.50,  lWristPitch:   0, rWristPitch:   0 },  // Neutral
      { t: 0.75,  lWristPitch: -55, rWristPitch: -55 },  // Extension
      { t: 0.85,  lWristPitch: -55, rWristPitch: -55 },  // hold
      { t: 1.00,  lWristPitch:   0, rWristPitch:   0 },
    ],
    feedback: {
      start: 'Gập cổ tay xuống từ từ',
      peak: 'Giữ, rồi ngửa lên phía trước',
      end: 'Trả về trung tâm',
    }
  },

  /**
   * FULL RANGE OF MOTION (combo)
   * Kết hợp gập vai (90°) + gập khuỷu (120°) trong một chu trình mượt.
   * Reference: AAOS shoulder flexion 0–180°, elbow flexion 0–150°.
   */
  full_rom: {
    name: 'Vận động toàn bộ (Full ROM)',
    clinicalRef: 'Kết hợp AAOS: vai 0–90°, khuỷu 0–120° (mức phục hồi)',
    description: 'Nâng tay ra trước rồi gập khuỷu, lặp lại nhịp nhàng',
    targetDegrees: 120,
    side: 'bilateral',
    reps: 8,
    holdSec: 1,
    upperArmPitch: 0,
    keyframes: [
      { t: 0.00, lPitch:  0, rPitch:  0, lForearmPitch:   0, rForearmPitch:   0 },
      { t: 0.25, lPitch: 90, rPitch: 90, lForearmPitch:   0, rForearmPitch:   0 }, // nâng tay 90°
      { t: 0.50, lPitch: 90, rPitch: 90, lForearmPitch: 120, rForearmPitch: 120 }, // gập khuỷu 120°
      { t: 0.65, lPitch: 90, rPitch: 90, lForearmPitch: 120, rForearmPitch: 120 }, // giữ
      { t: 0.80, lPitch: 90, rPitch: 90, lForearmPitch:   0, rForearmPitch:   0 }, // duỗi khuỷu
      { t: 1.00, lPitch:  0, rPitch:  0, lForearmPitch:   0, rForearmPitch:   0 }, // hạ tay
    ],
    feedback: {
      start: 'Nâng tay ra phía trước đến ngang vai',
      peak: 'Gập khuỷu đưa tay về vai, giữ',
      end: 'Duỗi khuỷu và hạ tay xuống',
    }
  },
};

// ============================================================
// EASING FUNCTIONS
// ============================================================
const ease = {
  /** Smooth slow-in slow-out — chuẩn cho rehab (tránh gật) */
  inOut: (t) => t < 0.5 ? 2*t*t : -1+(4-2*t)*t,
  /** Ease in only */
  in: (t) => t * t,
  /** Linear */
  linear: (t) => t,
};

// ============================================================
// EXERCISE ANIMATOR CLASS
// ============================================================
export class ExerciseAnimator {
  /**
   * @param {Object} model - THREE.Object3D (loaded GLB)
   * @param {Object} boneMap - { segment: boneName }
   */
  constructor(model, boneMap) {
    this.model = model;
    this.boneMap = boneMap;
    this.bones = {};
    this.restQuaternions = {};
    // World-space rest data for direction-based (anatomical) posing
    this.boneWorldRest = {};     // seg -> world quaternion at rest
    this.parentWorldRest = {};   // seg -> parent's world quaternion at rest
    this.restLimbDir = {};       // seg -> world-space limb direction at rest (unit, bone local +Y)

    /** @type {string|null} */
    this.currentExercise = null;
    this.isPlaying = false;
    this.repCount = 0;
    this.repProgress = 0;  // 0..1 within current rep
    this.lastTime = 0;
    this.repDurationMs = 4000;  // 4s per rep default

    this._resolveBones();
  }

  _resolveBones() {
    // Tolerant matching: GLTFLoader sanitizes ':' out of node names, so
    // "mixamorig:LeftArm" becomes "mixamorigLeftArm". Normalize both sides.
    const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
    const wanted = {}; // normalized bone name -> segment
    for (const [seg, boneName] of Object.entries(this.boneMap)) {
      wanted[norm(boneName)] = seg;
    }

    // Ensure world matrices are current before reading world transforms
    this.model.updateMatrixWorld(true);

    this.model.traverse((obj) => {
      if (!obj.isBone) return;
      const seg = wanted[norm(obj.name)];
      if (!seg || this.bones[seg]) return;
      this.bones[seg] = obj;
      this.restQuaternions[seg] = obj.quaternion.clone();

      const wq = new THREE.Quaternion();
      obj.getWorldQuaternion(wq);
      this.boneWorldRest[seg] = wq.clone();
      // Limb axis for a Mixamo bone is its local +Y (points to the child)
      this.restLimbDir[seg] = new THREE.Vector3(0, 1, 0).applyQuaternion(wq).normalize();
      const pq = new THREE.Quaternion();
      if (obj.parent) obj.parent.getWorldQuaternion(pq);
      this.parentWorldRest[seg] = pq.clone();
    });

    // Stand in a natural pose (arms down), not the bind T-pose
    this._poseNeutral(1.0);
  }

  /**
   * Bắt đầu chạy 1 exercise
   * @param {string} key - key trong CLINICAL_EXERCISES
   * @param {Object} opts
   * @param {number} [opts.repDurationMs=4000]
   * @param {Function} [opts.onRepComplete]
   * @param {Function} [opts.onFeedback]
   */
  start(key, opts = {}) {
    const ex = CLINICAL_EXERCISES[key];
    if (!ex) { console.warn(`[ExerciseAnimator] Unknown exercise: ${key}`); return; }

    this.currentExercise = key;
    this.isPlaying = true;
    this.repCount = 0;
    this.repProgress = 0;
    this.lastTime = performance.now();
    this.repDurationMs = opts.repDurationMs || 4000;
    this.onRepComplete = opts.onRepComplete || null;
    this.onFeedback = opts.onFeedback || null;
    this._lastFeedbackZone = null;
  }

  stop() {
    this.isPlaying = false;
    this.currentExercise = null;
    // idle update() eases back to the neutral (arms-down) standing pose
  }

  /**
   * Gọi trong animation loop (requestAnimationFrame)
   * @param {number} nowMs - performance.now()
   */
  update(nowMs) {
    if (!this.isPlaying || !this.currentExercise) {
      // Stand in the neutral (arms-down) pose when idle / after stopping
      this._poseNeutral(0.15);
      return;
    }

    const ex = CLINICAL_EXERCISES[this.currentExercise];
    const dt = nowMs - this.lastTime;
    this.lastTime = nowMs;

    this.repProgress += dt / this.repDurationMs;

    if (this.repProgress >= 1.0) {
      this.repProgress = 0;
      this.repCount++;
      this.onRepComplete?.(this.repCount);
      if (this.repCount >= ex.reps) {
        this.stop();
        return;
      }
    }

    // Interpolate keyframes → joint angles → anatomical pose
    const pose = this._interpolateKeyframes(ex.keyframes, this.repProgress);
    this._poseArms(this._anglesFromPose(ex, pose), 0.3);

    // Trigger feedback at key zones
    this._triggerFeedback(ex, this.repProgress);
  }

  /** Nội suy giữa các keyframe theo t=0..1 */
  _interpolateKeyframes(keyframes, t) {
    // Tìm đoạn keyframe chứa t
    let kA = keyframes[0], kB = keyframes[1];
    for (let i = 0; i < keyframes.length - 1; i++) {
      if (t >= keyframes[i].t && t <= keyframes[i+1].t) {
        kA = keyframes[i];
        kB = keyframes[i+1];
        break;
      }
    }

    // Normalize t trong đoạn [kA.t, kB.t]
    const span = kB.t - kA.t;
    const localT = span > 0 ? (t - kA.t) / span : 0;
    const easedT = ease.inOut(localT);

    // Nội suy tất cả property
    const result = {};
    const allKeys = new Set([...Object.keys(kA), ...Object.keys(kB)]);
    allKeys.delete('t');
    for (const key of allKeys) {
      const a = kA[key] ?? 0;
      const b = kB[key] ?? 0;
      result[key] = a + (b - a) * easedT;
    }
    return result;
  }

  /**
   * Map interpolated keyframe values → joint angles (degrees).
   * pitch = flexion (raise forward), roll = abduction (raise sideways),
   * forearmPitch = elbow flexion, wristPitch = wrist flexion.
   */
  _anglesFromPose(ex, pose) {
    const upBase = ex.upperArmPitch || 0; // slight forward flexion baseline (e.g. elbow curls)
    return {
      lFlex:  (pose.lPitch || 0) + upBase,
      lAbd:   (pose.lRoll  || 0),
      lElbow: (pose.lForearmPitch || 0),
      lWrist: (pose.lWristPitch   || 0),
      rFlex:  (pose.rPitch || 0) + upBase,
      rAbd:   (pose.rRoll  || 0),
      rElbow: (pose.rForearmPitch || 0),
      rWrist: (pose.rWristPitch   || 0),
    };
  }

  /**
   * Pose both arms from anatomical angles using WORLD-space limb directions.
   * This is rig-agnostic: each limb is oriented to point along a target world
   * direction, so flexion/abduction are anatomically correct regardless of the
   * model's bind pose (T-pose) or Mixamo bone-local axes. The neutral (all
   * angles 0) is arms-down at the sides — not the T-pose.
   */
  _poseArms(a, k) {
    const D = Math.PI / 180;
    const X = new THREE.Vector3(1, 0, 0); // sagittal axis (flexion / forward)
    const Z = new THREE.Vector3(0, 0, 1); // frontal axis (abduction / sideways)
    const HINGE = new THREE.Vector3(1, 0, 0); // forearm/wrist local hinge axis (flip to (0,0,1) if elbow bends sideways)

    // Upper arm: orient its limb axis along a world-space target direction.
    const orientUpper = (seg, dir, kk) => {
      const bone = this.bones[seg];
      const restDir = this.restLimbDir[seg];
      const parentWorld = this.parentWorldRest[seg];
      if (!bone || !restDir || !parentWorld) return;
      const delta = new THREE.Quaternion().setFromUnitVectors(restDir, dir);
      const worldNew = delta.multiply(this.boneWorldRest[seg].clone()); // delta * worldRest
      const localNew = parentWorld.clone().invert().multiply(worldNew);
      bone.quaternion.slerp(localNew, kk);
    };

    // Forearm / wrist: pure hinge about a LOCAL axis, relative to the rest pose.
    // The bone is a child of the (already-posed) upper arm, so it inherits the
    // arm orientation and only adds the joint bend — this keeps the natural
    // twist of the limb (no splayed/twisted hands).
    const hinge = (seg, deg, kk) => {
      const bone = this.bones[seg];
      const rest = this.restQuaternions[seg];
      if (!bone || !rest) return;
      const q = rest.clone().multiply(new THREE.Quaternion().setFromAxisAngle(HINGE, deg * D));
      bone.quaternion.slerp(q, kk);
    };

    // Upper-arm direction: arms-down neutral, add abduction then flexion.
    // If a direction looks reversed on your model, flip the sign on that line.
    const upperDir = (flexDeg, abdDeg, side) => {
      const d = new THREE.Vector3(0, -1, 0);   // arms-down neutral
      d.applyAxisAngle(Z, side * abdDeg * D);    // abduction (out to the side)
      d.applyAxisAngle(X, -flexDeg * D);         // flexion (raise forward)
      return d.normalize();
    };

    // LEFT: upper arm (direction) → forearm/elbow + hand/wrist (local hinge)
    orientUpper('left_upper_arm', upperDir(a.lFlex || 0, a.lAbd || 0, +1), k);
    hinge('left_forearm', -(a.lElbow || 0), k);  // elbow flexion
    hinge('left_wrist',   -(a.lWrist || 0), k);  // wrist flexion

    // RIGHT (mirror abduction side)
    orientUpper('right_upper_arm', upperDir(a.rFlex || 0, a.rAbd || 0, -1), k);
    hinge('right_forearm', -(a.rElbow || 0), k);
    hinge('right_wrist',   -(a.rWrist || 0), k);
  }

  /** Neutral standing pose: arms down at the sides. */
  _poseNeutral(k) {
    this._poseArms({}, k);
  }

  /**
   * Pose the model directly from anatomical joint angles (degrees), without
   * running a scripted exercise — used to drive the patient/IMU model so it
   * shares the guide's arms-down neutral (angles 0 = standing, arms at sides).
   * @param {{lFlex?:number,lAbd?:number,lElbow?:number,lWrist?:number,
   *          rFlex?:number,rAbd?:number,rElbow?:number,rWrist?:number}} angles
   * @param {number} [k=0.35] slerp factor (smoothing)
   */
  poseFromAngles(angles, k = 0.35) {
    this._poseArms(angles || {}, k);
  }

  _triggerFeedback(ex, t) {
    let zone = 'start';
    if (t > 0.40 && t < 0.70) zone = 'peak';
    else if (t >= 0.70) zone = 'end';

    if (zone !== this._lastFeedbackZone) {
      this._lastFeedbackZone = zone;
      const msg = ex.feedback?.[zone];
      if (msg) this.onFeedback?.(msg, zone);
    }
  }

  /** Display name of an exercise key (for UI labels). */
  exerciseName(key) {
    return CLINICAL_EXERCISES[key]?.name || null;
  }

  /** Debug: tạo animation ngay lập tức tại t = 0..1 */
  previewAtT(exerciseKey, t) {
    const ex = CLINICAL_EXERCISES[exerciseKey];
    if (!ex) return;
    const pose = this._interpolateKeyframes(ex.keyframes, t);
    this._poseArms(this._anglesFromPose(ex, pose), 1.0);
  }
}
