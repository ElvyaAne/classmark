import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { secretKeyProblem } from "./src/keys";

export default defineConfig(({ mode }) => {
  // Anything in a VITE_ variable ends up in the public JavaScript, so refuse to build with a
  // secret Supabase key there.
  const env = loadEnv(mode, process.cwd(), "VITE_");
  for (const [name, value] of Object.entries(env)) {
    const problem = secretKeyProblem(value);
    if (problem) {
      throw new Error(`${name}: ${problem}. Use the anon (public) key from Supabase → Project Settings → API.`);
    }
  }
  return { plugins: [react()] };
});
