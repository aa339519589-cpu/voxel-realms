import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/react") || id.includes("node_modules/lucide-react")) return "react-ui";
          if (id.includes("node_modules/idb")) return "storage";
          return undefined;
        },
      },
    },
  },
});
