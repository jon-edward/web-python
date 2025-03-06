import { defineConfig } from "vite";
import mkcert from "vite-plugin-mkcert";
import wasm from "vite-plugin-wasm";
import crossOriginIsolation from "vite-plugin-cross-origin-isolation";
import Sitemap from "vite-plugin-sitemap";

export default defineConfig({
  server: {
    https: true,
  },
  plugins: [wasm(), mkcert(), crossOriginIsolation(), Sitemap()],
  build: {
    target: "ES2022",
    rollupOptions: {
      input: {
        main: "index.html",
        about: "about.html",
      },
    },
  },
});
