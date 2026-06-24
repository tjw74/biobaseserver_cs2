import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  base: "/companion/",
  plugins: [react()],
  server: {
    proxy: {
      "/admin/api": { target: "http://127.0.0.1:8780", changeOrigin: true },
    },
  },
})
