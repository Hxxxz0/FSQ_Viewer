# Repository Guidelines

## Project Structure & Module Organization
The root app is a Vite + Vue 3 viewer for MuJoCo policies. UI entry points live in `src/`, with the main demo in `src/views/Demo.vue`, app bootstrap in `src/main.js`, and simulation/runtime code in `src/simulation/`. Static robot assets, scenes, ONNX checkpoints, and motion clips live under `public/examples/`. Utility scripts for exporting or reshaping motion data live in `scripts/`.

`mjlab_distill/` is a separate Python workspace for training, evaluation, and sim-to-real deployment. Core training code is in `mjlab_distill/active_adaptation/`, Hydra configs are in `mjlab_distill/cfg/`, and deployment/runtime code is in `mjlab_distill/sim2real/`.

## Build, Test, and Development Commands
- `npm install`: install root frontend dependencies.
- `npm run dev`: start the viewer locally with Vite on the network host.
- `npm run build`: produce a production frontend build.
- `npm run preview`: serve the built frontend locally for a final check.
- `cd mjlab_distill && uv sync`: install the Python training environment.
- `cd mjlab_distill && bash train.sh`: run the full training pipeline.
- `cd mjlab_distill && uv run torchrun --nproc_per_node=4 scripts/train.py task=G1/G1_tracking +exp=train`: run a single training stage.

## Coding Style & Naming Conventions
For `*.js`, `*.ts`, and `*.vue`, `.editorconfig` requires 2-space indentation, trimmed trailing whitespace, and a final newline. Vue components use PascalCase filenames such as `Demo.vue`; JavaScript modules generally use camelCase or descriptive file names such as `policyRunner.js`. Python code in `mjlab_distill/` follows 4-space indentation, snake_case for functions and variables, and PascalCase for classes. Match the style already used in the file you touch, especially where semicolon usage differs.

## Testing Guidelines
There is no dedicated root test suite yet. For frontend changes, run `npm run build` before opening a PR. For Python changes, prefer targeted smoke tests such as the affected `uv run ...` training or eval command, plus `cd mjlab_distill && uv run python -m py_compile active_adaptation scripts sim2real/src`.

## Commit & Pull Request Guidelines
Recent commits use short, imperative subjects like `add torque limit` and `update scene`. Keep commits focused and similarly concise. PRs should explain the subsystem touched, list validation commands, link any issue or experiment run, and include screenshots when UI behavior or rendered scenes change.

## Assets & Configuration
Do not commit generated datasets, model outputs, or large temporary artifacts. When adding a new robot or policy, keep scene files in `public/examples/scenes/<robot>/` and matching configs/checkpoints in `public/examples/checkpoints/<robot>/`.
