import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base: "./"  -> chemins relatifs, compatible avec GitHub Pages en sous-dossier
// (https://user.github.io/repo/) sans connaître le nom du repo.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
