import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// __dirname is /path/to/repo/frontend
// outDir resolves to /path/to/repo/app/static/dist  (local dev)
// In Docker, the Dockerfile overrides outDir via --outDir ./dist so the
// multi-stage build can COPY it cleanly into the final image.

export default defineConfig({
  plugins: [react()],

  // Assets are served from /static/dist/ — FastAPI already mounts
  // app/static/ at /static, so /static/dist/assets/... just works.
  base: '/static/dist/',

  build: {
    outDir: resolve(__dirname, '../app/static/dist'),
    // emptyOutDir disabled: bind-mounted dist/ doesn't support file deletion in dev.
    // Docker multi-stage builds write to a clean layer so this is fine in CI/prod.
    emptyOutDir: false,

    rollupOptions: {
      // Entry points are added here as each F-sprint migrates a page.
      // F0: empty — no pages migrated yet, old files still served.
      // F2: add login, signup, reset, invite
      // F3: add admin
      // F9: add canvas
      input: {
        // Entries are live now; which ones FastAPI *serves* is controlled
        // by _MIGRATED_PAGES in app/main.py.  Add a filename to that set
        // when the corresponding F-sprint is complete.
        admin:  resolve(__dirname, 'admin.html'),   // served after F6
        canvas: resolve(__dirname, 'canvas.html'),  // served after F9
        login:  resolve(__dirname, 'login.html'),   // served after F2
        signup: resolve(__dirname, 'signup.html'),  // served after F2
        reset:  resolve(__dirname, 'reset.html'),   // served after F2
        invite: resolve(__dirname, 'invite.html'),  // served after F2
      },
    },
  },
})
