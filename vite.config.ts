import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri требует фиксированный порт и отключенный auto-open
export default defineConfig({
  plugins: [react()],
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
