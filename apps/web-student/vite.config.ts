import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import path from "node:path"

// NOTE: @tanstack/router-plugin (TanStackRouterVite) intentionally NOT wired —
// routing en este frontend es useState-based; el plugin escaneaba src/routes/
// inexistente y tiraba ENOENT al startup. Migración a TanStack Router
// type-safe está prevista para F2-F3. Cuando llegue, re-importar
// { TanStackRouterVite } from "@tanstack/router-plugin/vite" y agregar
// TanStackRouterVite({ target: "react", autoCodeSplitting: true }) al inicio
// del array `plugins` (debe ir ANTES de react()). Dep ya está en package.json.
// `test` es config de Vitest, no de Vite. Vitest la lee del mismo archivo
// pero la firma de `defineConfig` de vite (con exactOptionalPropertyTypes)
// la rechaza. Para evitar acoplar el typecheck al paquete `vitest/config`
// (que arrastra otra versión de vite y rompe los plugin types), declaramos
// el bloque por separado y lo mergeamos con un type que lo permite.
const vitestConfig = {
  test: {
    environment: "jsdom",
    globals: true,
  },
} as const

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_URL || "http://127.0.0.1:8000",
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            // Dev-only: el api-gateway no tiene JWT validator (Keycloak
            // sin realm). Inyectamos X-* para que dev_trust_headers acepte.
            proxyReq.removeHeader("authorization")
            // UUID del estudiante 1 de la comision A-Manana (seed-3-comisiones.py).
            // Para loguearte como otro estudiante, cambia este UUID:
            //   A-Manana: b1b1b1b1-000{1..6}-... (6 estudiantes)
            //   B-Tarde:  b2b2b2b2-000{1..6}-...
            //   C-Noche:  b3b3b3b3-000{1..6}-...
            proxyReq.setHeader("x-user-id", "b1b1b1b1-0001-0001-0001-000000000001")
            proxyReq.setHeader("x-tenant-id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            proxyReq.setHeader("x-user-email", "estudiante@demo-uni.edu")
            proxyReq.setHeader("x-user-roles", "estudiante,classifier_worker")
          })
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  ...vitestConfig,
})
