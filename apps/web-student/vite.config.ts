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
            // Dev-only: el api-gateway no tiene JWT validator (Keycloak
            // sin realm). Inyectamos X-* para que dev_trust_headers acepte.
            proxyReq.removeHeader("authorization")
            proxyReq.setHeader("x-user-id", "a1a1a1a1-0001-0001-0001-000000000001")
            proxyReq.setHeader("x-tenant-id", "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
            proxyReq.setHeader("x-user-email", "estudiante@demo-uni.edu")
            proxyReq.setHeader("x-user-roles", "estudiante")
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
