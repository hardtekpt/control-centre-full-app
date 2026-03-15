# [Control Centre Refactor Plan]

## Goal

Refactor the codebase into a clear Electron + React + TypeScript structure with strict process boundaries, typed IPC, and normalized styling.

## Recovered Phases

1. Stabilize dev runtime and rendering startup
   - Fix renderer visibility regressions and blank windows.
   - Eliminate stale build races in Electron dev startup.
   - Status: Completed

2. Modularize main-process IPC wiring
   - Extract settings, mixer, and DDC handlers from `main` entry.
   - Add app/window handler modules to reduce `wireIpc` complexity.
   - Status: Completed

3. Implement target folder structure
   - Move code to:
     - `src/main`
     - `src/preload`
     - `src/renderer`
     - `src/shared`
   - Rename main/preload entries to `index.ts`.
   - Update TypeScript, Vite, Tailwind, and npm scripts for new paths.
   - Status: Completed

4. Main-process architecture alignment
   - Extracted snapshot persistence/migration IO into `src/main/services/persistence/service.ts`.
   - Extracted notification timer lifecycle orchestration into `src/main/services/notifications/timerService.ts`.
   - Extracted app-level notification popup window stack/layout into `src/main/services/notifications/windowService.ts`.
   - Wired `src/main/index.ts` to consume notification services while preserving existing notification behavior.
   - Continue extracting notification lifecycle and persistence into dedicated services.
   - Keep `src/main/index.ts` as orchestration entry only.
   - Status: In Progress

5. Renderer state architecture alignment
   - Keep typed bridge usage centralized and maintain store-driven UI updates.
   - Continue normalizing styling patterns toward Tailwind utility-first usage.
   - Status: Pending

6. Packaging and updater hardening
   - Keep electron-builder config in sync with moved asset/runtime paths.
   - Integrate updater module with proper error handling.
   - Status: Pending

7. Test coverage and release checks
   - Validate typecheck/build/dev flows after each phase.
   - Add/expand IPC and service tests as modules stabilize.
   - Status: Pending
