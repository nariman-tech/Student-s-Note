import { defineConfig, type Plugin } from "vite";

// Список всех файлов сборки для офлайн-режима: service worker (public/sw.js) скачивает их
// при установке, чтобы без интернета открывались все разделы, а не только уже посещённые
function precacheList(): Plugin {
  return {
    name: "lectiva-precache-list",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => f.startsWith("assets/") && !f.endsWith(".map"))
        .map((f) => `/${f}`);
      this.emitFile({ type: "asset", fileName: "precache.json", source: JSON.stringify(files) });
    },
  };
}
import react from "@vitejs/plugin-react";

// Tauri требует фиксированный порт и отключенный auto-open
export default defineConfig({
  plugins: [react(), precacheList()],
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      output: {
        // Библиотеки — отдельными файлами: они меняются редко, и после обновления приложения
        // браузер берёт их из кэша, а скачивает заново только наш код
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
        },
      },
    },
  },
});
