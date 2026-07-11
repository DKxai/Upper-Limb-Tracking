/**
 * ExerciseGuidance - Exercise guidance system with target angles and real-time feedback
 */

import { eventBus } from '../utils/EventBus.js';
import { Events } from '../utils/Constants.js';

// Exercise library
const EXERCISES = {
  shoulder_flexion: {
    name: 'Shoulder Flexion (Gập Vai)',
    description: 'Nâng tay lên phía trước đến khi song song với sàn',
    targets: {
      leftShoulderFlexion: { min: 80, max: 100, optimal: 90 },
    },
    duration: 30, // seconds
    reps: 10,
    instructions: [
      'Đứng thẳng, tay buông thõng',
      'Từ từ nâng tay lên phía trước',
      'Giữ tay thẳng, nâng đến góc 90°',
      'Giữ trong 2 giây, sau đó hạ xuống'
    ]
  },
  
  shoulder_abduction: {
    name: 'Shoulder Abduction (Dạng Vai)',
    description: 'Nâng tay ra hai bên cho đến khi ngang vai',
    targets: {
      leftShoulderAbduction: { min: 80, max: 100, optimal: 90 },
    },
    duration: 30,
    reps: 10,
    instructions: [
      'Đứng thẳng, tay buông xuôi',
      'Nâng cả hai tay ra hai bên',
      'Giữ tay thẳng đến khi ngang vai (90°)',
      'Từ từ hạ tay xuống'
    ]
  },
  
  elbow_flexion: {
    name: 'Elbow Flexion (Gập Khuỷu)',
    description: 'Gập khuỷu tay để mang bàn tay lên vai',
    targets: {
      leftElbowFlexion: { min: 120, max: 140, optimal: 130 },
    },
    duration: 25,
    reps: 15,
    instructions: [
      'Đứng hoặc ngồi, vai giữ yên',
      'Từ từ gập khuỷu tay',
      'Đưa bàn tay về phía vai (130°)',
      'Duỗi thẳng trở lại'
    ]
  },
  
  full_rom: {
    name: 'Full Range of Motion (Vận động toàn bộ)',
    description: 'Kết hợp các chuyển động vai, khuỷu và cổ tay',
    targets: {
      leftShoulderFlexion: { min: 60, max: 120, optimal: 90 },
      leftElbowFlexion: { min: 90, max: 140, optimal: 120 },
    },
    duration: 45,
    reps: 8,
    instructions: [
      'Nâng tay lên trước (90°)',
      'Gập khuỷu tay (120°)',
      'Duỗi khuỷu trở lại',
      'Hạ tay xuống từ từ'
    ]
  }
};

export class ExerciseGuidance {
  constructor() {
    this.currentExercise = null;
    this.isActive = false;
    this.startTime = null;
    this.completedReps = 0;
    this.currentAngles = {};
    this.feedbackHistory = [];
    
    // UI elements
    this.container = null;
    this.$exerciseTitle = null;
    this.$instructions = null;
    this.$targetDisplay = null;
    this.$feedbackDisplay = null;
    this.$progressBar = null;
    this.$repCounter = null;
    
    // Event unsubscribe
    this._unsubscribe = null;
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      console.error(`[ExerciseGuidance] Container #${containerId} not found`);
      return;
    }
    
    this._renderUI();
    this._bindElements();
    
    // Subscribe to data
    this._unsubscribe = eventBus.on(Events.PROCESSED_DATA_READY, (sample) => {
      if (this.isActive) {
        this._updateExercise(sample);
      }
    });
  }

  _renderUI() {
    this.container.innerHTML = `
      <div class="exercise-guidance-panel">
        <!-- Exercise Selection -->
        <div class="exercise-selector" id="exercise-selector">
          <h3>Chọn bài tập</h3>
          <div class="exercise-list">
            ${Object.entries(EXERCISES).map(([key, ex]) => `
              <button class="exercise-card" data-exercise="${key}">
                <strong>${ex.name}</strong>
                <p>${ex.description}</p>
                <span class="exercise-meta">${ex.reps} lần • ${ex.duration}s</span>
              </button>
            `).join('')}
          </div>
        </div>
        
        <!-- Active Exercise View -->
        <div class="exercise-active" id="exercise-active" style="display: none;">
          <div class="exercise-header">
            <h2 id="exercise-title">—</h2>
            <button class="btn-stop" id="btn-stop-exercise">Dừng</button>
          </div>
          
          <div class="exercise-progress">
            <div class="progress-bar" id="exercise-progress">
              <div class="progress-fill"></div>
            </div>
            <p class="rep-counter" id="rep-counter">Rep: 0 / 10</p>
          </div>
          
          <div class="instructions-panel" id="instructions">
            <h4>Hướng dẫn:</h4>
            <ol></ol>
          </div>
          
          <div class="target-display" id="target-display">
            <h4>Mục tiêu:</h4>
            <div class="target-list"></div>
          </div>
          
          <div class="feedback-display" id="feedback-display">
            <div class="feedback-current">Sẵn sàng...</div>
          </div>
        </div>
      </div>
    `;
  }

  _bindElements() {
    // Bind exercise card clicks
    this.container.querySelectorAll('.exercise-card').forEach(card => {
      card.addEventListener('click', () => {
        const exerciseKey = card.dataset.exercise;
        this.startExercise(exerciseKey);
      });
    });
    
    // Bind stop button
    const stopBtn = this.container.querySelector('#btn-stop-exercise');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => this.stopExercise());
    }
    
    // Cache elements
    this.$exerciseTitle = this.container.querySelector('#exercise-title');
    this.$instructions = this.container.querySelector('#instructions ol');
    this.$targetDisplay = this.container.querySelector('#target-display .target-list');
    this.$feedbackDisplay = this.container.querySelector('.feedback-current');
    this.$progressBar = this.container.querySelector('.progress-fill');
    this.$repCounter = this.container.querySelector('#rep-counter');
  }

  startExercise(exerciseKey) {
    const exercise = EXERCISES[exerciseKey];
    if (!exercise) return;
    
    this.currentExercise = { key: exerciseKey, ...exercise };
    this.isActive = true;
    this.startTime = Date.now();
    this.completedReps = 0;
    this.feedbackHistory = [];
    
    // Show active view
    this.container.querySelector('#exercise-selector').style.display = 'none';
    this.container.querySelector('#exercise-active').style.display = 'block';
    
    // Populate UI
    this.$exerciseTitle.textContent = exercise.name;
    
    this.$instructions.innerHTML = exercise.instructions
      .map(step => `<li>${step}</li>`)
      .join('');
    
    this.$targetDisplay.innerHTML = Object.entries(exercise.targets)
      .map(([angle, range]) => `
        <div class="target-item">
          <span class="target-label">${this._formatAngleName(angle)}</span>
          <span class="target-range">${range.min}° - ${range.max}°</span>
          <span class="target-optimal">Tối ưu: ${range.optimal}°</span>
        </div>
      `).join('');
    
    this._updateRepCounter();
    this.$feedbackDisplay.textContent = 'Bắt đầu bài tập...';
    this.$feedbackDisplay.className = 'feedback-current';

    // Notify 3D view to start guide animation.
    // IMPORTANT: must include `key` — Arm3DViewHumanoid uses it to pick the
    // clinical keyframe sequence; without it the guide model never moves.
    eventBus.emit(Events.EXERCISE_GUIDE_START, {
      key: exerciseKey,
      targets: exercise.targets,
      name: exercise.name,
    });
  }

  stopExercise() {
    this.isActive = false;
    this.currentExercise = null;
    
    // Notify 3D view to stop guide animation
    eventBus.emit(Events.EXERCISE_GUIDE_STOP);
    
    // Show selector
    this.container.querySelector('#exercise-selector').style.display = 'block';
    this.container.querySelector('#exercise-active').style.display = 'none';
  }

  _updateExercise(sample) {
    if (!this.currentExercise) return;
    
    // Update current angles
    this.currentAngles = sample.jointAngles;
    
    // Check targets
    const feedback = this._evaluateTargets();
    this._displayFeedback(feedback);
    
    // Update progress
    const elapsed = (Date.now() - this.startTime) / 1000;
    const progress = Math.min(100, (elapsed / this.currentExercise.duration) * 100);
    this.$progressBar.style.width = `${progress}%`;
    
    // Auto-complete on time
    if (elapsed >= this.currentExercise.duration) {
      this._completeRep();
    }
  }

  _evaluateTargets() {
    const targets = this.currentExercise.targets;
    const results = [];
    let allInRange = true;
    
    Object.entries(targets).forEach(([angleName, range]) => {
      const currentValue = this.currentAngles[angleName] || 0;
      const inRange = currentValue >= range.min && currentValue <= range.max;
      const deviation = Math.abs(currentValue - range.optimal);
      
      if (!inRange) allInRange = false;
      
      results.push({
        angle: angleName,
        current: currentValue,
        target: range.optimal,
        inRange,
        deviation,
        feedback: this._generateFeedback(angleName, currentValue, range)
      });
    });
    
    return { results, allInRange };
  }

  _generateFeedback(angleName, current, range) {
    if (current < range.min) {
      return `${this._formatAngleName(angleName)}: Tăng thêm ${Math.round(range.min - current)}°`;
    } else if (current > range.max) {
      return `${this._formatAngleName(angleName)}: Giảm ${Math.round(current - range.max)}°`;
    } else {
      const deviation = Math.abs(current - range.optimal);
      if (deviation < 5) {
        return `${this._formatAngleName(angleName)}: Hoàn hảo!`;
      } else {
        return `${this._formatAngleName(angleName)}: Tốt (${Math.round(current)}°)`;
      }
    }
  }

  _displayFeedback(feedback) {
    const messages = feedback.results.map(r => r.feedback);
    this.$feedbackDisplay.innerHTML = messages.join('<br>');
    
    if (feedback.allInRange) {
      this.$feedbackDisplay.className = 'feedback-current feedback-success';
    } else {
      this.$feedbackDisplay.className = 'feedback-current feedback-warning';
    }
  }

  _completeRep() {
    this.completedReps++;
    this._updateRepCounter();
    
    if (this.completedReps >= this.currentExercise.reps) {
      this._finishExercise();
    } else {
      // Reset timer for next rep
      this.startTime = Date.now();
      this.$feedbackDisplay.textContent = `Rep ${this.completedReps} hoàn thành! Bắt đầu rep tiếp theo...`;
      this.$feedbackDisplay.className = 'feedback-current feedback-success';
    }
  }

  _updateRepCounter() {
    if (this.$repCounter) {
      this.$repCounter.textContent = `Rep: ${this.completedReps} / ${this.currentExercise.reps}`;
    }
  }

  _finishExercise() {
    this.$feedbackDisplay.textContent = `Hoàn thành bài tập! Tốt lắm!`;
    this.$feedbackDisplay.className = 'feedback-current feedback-success';
    
    setTimeout(() => {
      this.stopExercise();
    }, 3000);
  }

  _formatAngleName(name) {
    const names = {
      leftShoulderFlexion: 'Gập vai trái',
      leftShoulderAbduction: 'Dạng vai trái',
      leftElbowFlexion: 'Gập khuỷu trái',
      leftWristFlexion: 'Gập cổ tay trái',
      rightShoulderFlexion: 'Gập vai phải',
      rightShoulderAbduction: 'Dạng vai phải',
      rightElbowFlexion: 'Gập khuỷu phải',
      rightWristFlexion: 'Gập cổ tay phải',
    };
    return names[name] || name;
  }

  /**
   * Cleanup resources
   */
  destroy() {
    this.stopExercise();
    if (this._unsubscribe) {
      this._unsubscribe();
    }
  }
}
