import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  base: "/",
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          tremor: ["@tremor/react"],
          table: ["@tanstack/react-table"],
        },
      },
    },
  },
  server: {
    proxy: {
      "/api": "http://localhost:4000",
      "/mcp": "http://localhost:4000",
    },
  },
});
