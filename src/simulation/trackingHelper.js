import * as THREE from 'three';
import {
  quatMultiply,
  quatInverse,
  yawComponent,
  linspaceRows,
  slerpMany
} from './utils/math.js';

function clampIndex(idx, length) {
  if (idx < 0) {
    return 0;
  }
  if (idx >= length) {
    return length - 1;
  }
  return idx;
}

function toFloat32Rows(rows) {
  if (!Array.isArray(rows)) {
    return null;
  }
  return rows.map((row) => Float32Array.from(row));
}

function normalizeMotionClip(clip) {
  if (!clip || typeof clip !== 'object') {
    return null;
  }
  const jointPosRaw = toFloat32Rows(clip.joint_pos ?? clip.jointPos);
  const rootPos = toFloat32Rows(clip.root_pos ?? clip.rootPos);
  const rootQuat = toFloat32Rows(clip.root_quat ?? clip.rootQuat);
  if (!jointPosRaw || !rootPos || !rootQuat) {
    return null;
  }
  return { jointPos: jointPosRaw, rootPos, rootQuat };
}

export class TrackingHelper {
  constructor(config) {
    this.transitionSteps = config.transition_steps ?? 100;
    this.futureSteps = Array.isArray(config.future_steps) ? config.future_steps.slice() : [0, 2, 4, 8, 16];
    this.futureHistoryLen = Math.max(0, ...this.futureSteps.map((step) => Math.max(0, -Math.trunc(step))));
    const configuredTail = Number.isFinite(Number(config.switch_tail_keep_steps))
      ? Math.max(0, Math.trunc(Number(config.switch_tail_keep_steps)))
      : this.futureHistoryLen;
    this.switchTailKeepSteps = Math.max(configuredTail, this.futureHistoryLen);
    this.datasetJointNames = config.dataset_joint_names ?? [];
    this.policyJointNames = config.policy_joint_names ?? [];
    this.motions = {};
    this.motionMeta = {};
    this.nJoints = this.policyJointNames.length;
    this.transitionLen = 0;
    this.motionLen = 0;

    this.mapDatasetToPolicy = this._buildDatasetToPolicyMap();
    const configMotionMeta = (config.motion_meta && typeof config.motion_meta === 'object')
      ? config.motion_meta
      : {};

    for (const [name, clip] of Object.entries(config.motions ?? {})) {
      const normalized = normalizeMotionClip(clip);
      if (!normalized) {
        console.warn('TrackingHelper: invalid motion clip', name);
        continue;
      }
      normalized.jointPos = normalized.jointPos.map((row) => this._mapDatasetJointPosToPolicy(row));
      this.motions[name] = normalized;
      const meta = configMotionMeta[name];
      this.motionMeta[name] = {
        complianceSuitable: typeof meta?.compliance_suitable === 'boolean' ? meta.compliance_suitable : true
      };
    }

    if (!this.motions.default) {
      throw new Error('TrackingHelper requires a "default" motion');
    }

    this.refJointPos = [];
    this.refRootQuat = [];
    this.refRootPos = [];
    this.refIdx = 0;
    this.refLen = 0;
    this.currentName = 'default';
    this.currentDone = true;
  }

  availableMotions() {
    return Object.keys(this.motions);
  }

  isComplianceSuitable(name) {
    if (name === 'default') {
      return true;
    }
    return this.motionMeta[name]?.complianceSuitable ?? true;
  }


  addMotions(motions, options = {}) {
    const added = [];
    const skipped = [];
    const invalid = [];
    const allowOverwrite = !!options.overwrite;
    const motionMetaInput = (options.motion_meta && typeof options.motion_meta === 'object')
      ? options.motion_meta
      : null;

    if (!motions || typeof motions !== 'object') {
      return { added, skipped, invalid };
    }

    for (const [name, clip] of Object.entries(motions)) {
      if (!name) {
        invalid.push(name);
        continue;
      }
      if (!allowOverwrite && this.motions[name]) {
        skipped.push(name);
        continue;
      }
      const normalized = normalizeMotionClip(clip);
      if (!normalized) {
        invalid.push(name);
        continue;
      }
      normalized.jointPos = normalized.jointPos.map((row) => this._mapDatasetJointPosToPolicy(row));
      this.motions[name] = normalized;
      const meta = motionMetaInput?.[name];
      this.motionMeta[name] = {
        complianceSuitable: typeof meta?.compliance_suitable === 'boolean' ? meta.compliance_suitable : false
      };
      added.push(name);
    }

    return { added, skipped, invalid };
  }

  reset(state) {
    this.currentDone = true;
    this.refIdx = 0;
    this.refLen = 0;
    this.transitionLen = 0;
    this.motionLen = 0;
    this.refJointPos = [];
    this.refRootQuat = [];
    this.refRootPos = [];
    this.currentName = 'default';
    this.requestMotion('default', state);
  }

  requestMotion(name, state) {
    if (!this.motions[name]) {
      return false;
    }
    if ((this.currentName === 'default' && this.currentDone) || name === 'default') {
      this._startMotionFromCurrent(name, state);
      return true;
    }
    return false;
  }

  isReady() {
    return this.refLen > 0;
  }

  playbackState() {
    const clampedIdx = Math.max(0, Math.min(this.refIdx, Math.max(this.refLen - 1, 0)));
    const transitionLen = this.transitionLen ?? 0;
    const motionLen = this.motionLen ?? 0;
    const inTransition = transitionLen > 0 && clampedIdx < transitionLen;
    return {
      available: this.refLen > 0,
      currentName: this.currentName,
      currentDone: this.currentDone,
      refIdx: clampedIdx,
      refLen: this.refLen,
      transitionLen,
      motionLen,
      inTransition,
      isDefault: this.currentName === 'default'
    };
  }

  advance() {
    if (this.refLen === 0) {
      return;
    }
    if (this.refIdx < this.refLen - 1) {
      this.refIdx += 1;
      if (this.refIdx === this.refLen - 1) {
        this.currentDone = true;
      }
    }
  }

  getFrame(index) {
    const clamped = clampIndex(index, this.refLen);
    return {
      jointPos: this.refJointPos[clamped],
      rootQuat: this.refRootQuat[clamped],
      rootPos: this.refRootPos[clamped]
    };
  }

  _readCurrentState(state) {
    if (state) {
      return {
        jointPos: Array.from(state.jointPos),
        rootPos: Array.from(state.rootPos),
        rootQuat: Array.from(state.rootQuat)
      };
    }

    const defaultMotion = this.motions['default'];
    const fallbackPos = defaultMotion?.rootPos?.[0] ?? new Float32Array([0.0, 0.0, 0.78]);
    const fallbackQuat = defaultMotion?.rootQuat?.[0] ?? [1.0, 0.0, 0.0, 0.0];
    const fallbackJoint = defaultMotion?.jointPos?.[0] ?? new Float32Array(this.nJoints);

    return {
      jointPos: Array.from(fallbackJoint),
      rootPos: Array.from(fallbackPos),
      rootQuat: Array.from(fallbackQuat)
    };
  }

  _readRefTailState(state) {
    if (this.refLen > 0 && this.refJointPos.length && this.refRootPos.length && this.refRootQuat.length) {
      const tailIndex = this.refLen - 1;
      return {
        jointPos: Array.from(this.refJointPos[tailIndex]),
        rootPos: Array.from(this.refRootPos[tailIndex]),
        rootQuat: Array.from(this.refRootQuat[tailIndex])
      };
    }
    return this._readCurrentState(state);
  }

  _collectReferenceTail() {
    if (this.refLen <= 0) {
      return {
        jointPos: [],
        rootPos: [],
        rootQuat: [],
        anchorIndex: 0
      };
    }
    const keepHist = Math.max(this.futureHistoryLen, this.switchTailKeepSteps) + 2;
    const currentIdx = Math.max(0, Math.min(this.refIdx, this.refLen - 1));
    const start = Math.max(0, currentIdx - keepHist);
    const end = currentIdx + 1;
    return {
      jointPos: this.refJointPos.slice(start, end).map((row) => Float32Array.from(row)),
      rootPos: this.refRootPos.slice(start, end).map((row) => Float32Array.from(row)),
      rootQuat: this.refRootQuat.slice(start, end).map((row) => Float32Array.from(row)),
      anchorIndex: end - start - 1
    };
  }

  _appendRefFrames(frames) {
    if (!frames) {
      return;
    }
    const jointPos = Array.isArray(frames.jointPos) ? frames.jointPos : [];
    const rootPos = Array.isArray(frames.rootPos) ? frames.rootPos : [];
    const rootQuat = Array.isArray(frames.rootQuat) ? frames.rootQuat : [];
    if (jointPos.length === 0 || rootPos.length === 0 || rootQuat.length === 0) {
      return;
    }

    this.refJointPos.push(...jointPos.map((row) => Float32Array.from(row)));
    this.refRootPos.push(...rootPos.map((row) => Float32Array.from(row)));
    this.refRootQuat.push(...rootQuat.map((row) => Float32Array.from(row)));
    this.refLen = this.refJointPos.length;
    this.currentDone = this.refIdx >= this.refLen - 1;
    this._trimRefPrefix();
  }

  _trimRefPrefix() {
    if (this.refLen <= 0) {
      return;
    }
    const keepHist = Math.max(this.futureHistoryLen, this.switchTailKeepSteps) + 2;
    const drop = Math.max(0, this.refIdx - keepHist);
    if (drop <= 0) {
      return;
    }

    this.refJointPos.splice(0, drop);
    this.refRootPos.splice(0, drop);
    this.refRootQuat.splice(0, drop);
    this.refIdx -= drop;
    this.refLen = this.refJointPos.length;
    this.currentDone = this.refIdx >= this.refLen - 1;
  }

  _alignMotionToCurrent(motion, curr) {
    const p0 = new THREE.Vector3(...motion.rootPos[0]);
    const pc = new THREE.Vector3(...curr.rootPos);

    const q0 = yawComponent(motion.rootQuat[0]);
    const qc = yawComponent(curr.rootQuat);
    const qDeltaWxyz = quatMultiply(qc, quatInverse(q0));
    const qDelta = new THREE.Quaternion(qDeltaWxyz[1], qDeltaWxyz[2], qDeltaWxyz[3], qDeltaWxyz[0]);

    const jointPos = motion.jointPos.map((row) => Float32Array.from(row));

    const offset = new THREE.Vector3(pc.x, pc.y, p0.z);
    const rootPos = motion.rootPos.map((row) => {
      const pos = new THREE.Vector3(...row);
      pos.sub(p0).applyQuaternion(qDelta).add(offset);
      return Float32Array.from([pos.x, pos.y, pos.z]);
    });

    const rootQuat = motion.rootQuat.map((row) => {
      const q = new THREE.Quaternion(row[1], row[2], row[3], row[0]);
      const aligned = qDelta.clone().multiply(q);
      return Float32Array.from([aligned.w, aligned.x, aligned.y, aligned.z]);
    });

    return { jointPos, rootQuat, rootPos };
  }

  _buildTransition(curr, firstFrame) {
    const steps = Math.max(0, Math.floor(this.transitionSteps));
    if (steps === 0) {
      return {
        jointPos: [],
        rootQuat: [],
        rootPos: []
      };
    }

    const jointPos = linspaceRows(curr.jointPos, firstFrame.jointPos[0], steps);
    const rootPos = linspaceRows(curr.rootPos, firstFrame.rootPos[0], steps);
    const rootQuat = slerpMany(curr.rootQuat, firstFrame.rootQuat[0], steps);

    return { jointPos, rootPos, rootQuat };
  }

  _startMotionFromCurrent(name, state) {
    const preservedTail = this._collectReferenceTail();
    const curr = this._readRefTailState(state);
    const motion = this.motions[name];
    const aligned = this._alignMotionToCurrent(motion, curr);
    const firstFrame = {
      jointPos: aligned.jointPos,
      rootQuat: aligned.rootQuat,
      rootPos: aligned.rootPos
    };

    const transition = this._buildTransition(curr, firstFrame);

    this.refJointPos = preservedTail.jointPos.slice();
    this.refRootQuat = preservedTail.rootQuat.slice();
    this.refRootPos = preservedTail.rootPos.slice();

    this.transitionLen = transition.jointPos.length;
    this.motionLen = aligned.jointPos.length;
    this.refIdx = preservedTail.anchorIndex;
    this.refLen = this.refJointPos.length;
    this._appendRefFrames({
      jointPos: [...transition.jointPos, ...aligned.jointPos],
      rootQuat: [...transition.rootQuat, ...aligned.rootQuat],
      rootPos: [...transition.rootPos, ...aligned.rootPos]
    });
    this.currentName = name;
    this.currentDone = this.refIdx >= this.refLen - 1;
  }

  _buildDatasetToPolicyMap() {
    if (!this.datasetJointNames.length || !this.policyJointNames.length) {
      throw new Error('TrackingHelper requires dataset_joint_names and policy_joint_names');
    }
    const datasetIndex = new Map();
    for (let i = 0; i < this.datasetJointNames.length; i++) {
      datasetIndex.set(this.datasetJointNames[i], i);
    }
    return this.policyJointNames.map((name) => {
      if (!datasetIndex.has(name)) {
        throw new Error(`TrackingHelper: joint "${name}" missing in dataset_joint_names`);
      }
      return datasetIndex.get(name);
    });
  }

  _mapDatasetJointPosToPolicy(jointPos) {
    const out = new Float32Array(this.policyJointNames.length);
    for (let i = 0; i < this.mapDatasetToPolicy.length; i++) {
      const datasetIdx = this.mapDatasetToPolicy[i];
      out[i] = jointPos[datasetIdx] ?? 0.0;
    }
    return out;
  }
}
