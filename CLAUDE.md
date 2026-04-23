# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Humanoid Policy Viewer - a single-page Vue 3 + Vuetify app that runs a MuJoCo WebAssembly scene in the browser and drives it with an ONNX policy. The default setup loads the G1 humanoid robot scene, policy, and motion clips.

Demos:
- [Humanoid Policy Viewer](https://motion-tracking.axell.top/)
- [GentleHumanoid Web Demo](https://gentle-humanoid.axell.top/)

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start development server (--host, port 3000)
npm run build        # Build for production
npm run preview      # Preview production build
```

## Architecture

### Core Stack
- **Vue 3** + **Vuetify 3** - UI framework
- **Vite** - Build tool and dev server
- **Three.js** - 3D rendering
- **MuJoCo WebAssembly** - Physics simulation (via mujoco-js npm package)
- **ONNX Runtime Web** - Neural network inference

### Key Source Files

**Simulation Core (`src/simulation/`):**
- `main.js` - `MuJoCoDemo` class: bootstraps MuJoCo, Three.js renderer, and policy loop
- `mujocoUtils.js` - Scene/policy loading utilities, filesystem preloading, and Three.js scene construction
- `policyRunner.js` - `PolicyRunner` class: ONNX inference wrapper and observation pipeline
- `observationHelpers.js` - Observation modules for policy input
- `trackingHelper.js` - Motion tracking/retargeting utilities
- `onnxHelper.js` - ONNX model loading and execution wrapper
- `utils/` - Math utilities, drag interaction, reflector for floor

**UI Layer:**
- `views/Demo.vue` - Main UI controls for the live demo
- `App.vue` - Root Vue component
- `main.js` - Vue app entry point

### Data Flow

1. **Main Loop**: `MuJoCoDemo.main_loop()` runs the simulation at ~50Hz (20ms timestep)
2. **Policy Inference**: Each step, `policyRunner.step(state)` gets observations and runs ONNX model
3. **Control**: PD controller applies torques to reach target positions from policy
4. **Rendering**: Three.js renders the scene at up to 60fps

### Key Configuration

**Policy Config JSON** (`public/examples/checkpoints/<robot>/tracking_policy.json`):
- `onnx.path` - Path to ONNX model file
- `policy_joint_names` - List of joint names matching MJCF actuators
- `obs_config` - Observation configuration (uses names from `observationHelpers.js`)
- `action_scale`, `stiffness`, `damping`, `default_joint_pos` - Control gains
- `tracking.motions_path` - Path to motion index file (optional)

**Scene Files** (`public/examples/scenes/<robot>/`):
- MJCF XML file and meshes
- `files.json` - Index of all files to preload into MuJoCo's MEMFS

## Adding New Robots/Policies

1. **Add MJCF + assets** to `public/examples/scenes/<robot>/` and update `files.json`
2. **Add policy config + ONNX** to `public/examples/checkpoints/<robot>/`
3. **Update paths** in `src/simulation/main.js` (lines 6, 104, 106)

See README.md for detailed instructions.

## Important Notes

- **Coordinate System**: MuJoCo uses Z-up, Three.js uses Y-up - conversions happen in `getPosition()`, `getQuaternion()`, `toMujocoPos()`
- **Joint Mapping**: Policy joint names must exactly match MJCF joint names with actuators
- **Observation Modules**: Custom observations need to be added to `observationHelpers.js`
- **FSQ Policy Support**: Recent addition (see commit 28ac266)
- **Compliance Control**: Integrated in recent commits (see commit 0490320)
