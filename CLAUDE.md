# parallax_frontend

React 19 + Vite + TypeScript web editor for Parallax. Project-wide docs are in `../docs/`.

## Commands

```bash
npm ci
npm run dev        # http://localhost:5173, expects backend on :8080 (VITE_API_URL to override)
npm run build      # tsc -b && vite build
npm run lint       # oxlint (one known warning in auth/AuthProvider.tsx)
npm test           # vitest run
```

Env (`.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_URL`,
`VITE_ACCELERATED_PREVIEW=0` to disable the WebCodecs/WebGPU preview.

## Architecture

- `App.tsx`: dashboard ↔ editor. `auth/`: Supabase gate.
- `components/Editor.tsx` is the hub (chat stream handling, timeline state, autosave with
  `expected_revision`, media refresh). `toolLabel()` and `MEDIA_GENERATION_TOOLS` there must
  be updated when the backend adds tools.
- `lib/timeline.ts` converts the backend v3 wire format (frames, snake_case) ↔ the UI model.
  `lib/api.ts` is the only place that calls the backend.
- Preview: `PreviewStage` + `WebCodecsVideo` + `workers/videoDecoder.worker.ts` (WebGPU, falls
  back to `<video>`). Export is rendered by the backend, so preview and export can differ (see
  `../docs/AUDIT.md` B5).

## Conventions

- Remotes: `origin` = Yash-Satankar fork, `upstream` = Rohit-RA-2020.
- Never put secrets in `VITE_*` variables (they ship in the bundle); the Supabase publishable
  key is public by design.
