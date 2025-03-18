import { defineConfig } from "vite";

import mkcert from "vite-plugin-mkcert";
import wasm from "vite-plugin-wasm";
import crossOriginIsolation from "vite-plugin-cross-origin-isolation";
import Sitemap from "vite-plugin-sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    https: true,
  },
  plugins: [
    wasm(),
    mkcert(),
    crossOriginIsolation(),
    Sitemap({
      hostname: "https://web-python.pages.dev/",
    }),
    tailwindcss(),
  ],
  build: {
    target: "ES2022",
  },
});
