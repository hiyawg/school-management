import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Port 8081 so it can run next to the education app (8080).
export default defineConfig({
  server: {
    host: "::",
    port: 8081,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
