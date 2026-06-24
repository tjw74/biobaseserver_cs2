import path from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

const rawBase = process.env.VITE_DASHBOARD_BASE || "/"
const base =
  rawBase === "/"
    ? "/"
    : rawBase.endsWith("/")
      ? rawBase
      : `${rawBase}/`
const proxyPrefix = base.replace(/\/$/, "")

const viteBuildId =
  process.env.VITE_BUILD_ID?.trim() ||
  process.env.GITHUB_SHA?.slice(0, 7) ||
  new Date().toISOString()

const devProxy =
  base === "/"
    ? {
        "/api": { target: "http://127.0.0.1:8780", changeOrigin: true },
        "/health": { target: "http://127.0.0.1:8780", changeOrigin: true },
      }
    : {
        [`${proxyPrefix}/api`]: { target: "http://127.0.0.1:8780", changeOrigin: true },
        [`${proxyPrefix}/health`]: { target: "http://127.0.0.1:8780", changeOrigin: true },
      }

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(viteBuildId),
  },
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: devProxy,
  },
})
