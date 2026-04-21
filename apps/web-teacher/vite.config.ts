import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { TanStackRouterVite } from "@tanstack/router-plugin/vite"
import path from "node:path"

export default defineConfig({
  plugins: [
    TanStackRouterVite({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
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
            // Dev-only: el api-gateway no tiene JWT validator configurado
            // todavía (Keycloak sin realm). Inyectamos X-* para que
            // dev_trust_headers del gateway acepte el request.
            proxyReq.removeHeader("authorization")
            proxyReq.setHeader("x-user-id", "11111111-1111-1111-1111-111111111111")
            proxyReq.setHeader("x-tenant-id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            proxyReq.setHeader("x-user-email", "docente@demo-uni.edu")
            proxyReq.setHeader("x-user-roles", "docente")
          })
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
})
