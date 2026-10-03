import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApi } from "./api";
import "./styles.css";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
const captchaKey = (import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined) || undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App api={url && key ? createApi(url, key) : null} captchaKey={captchaKey} />
  </StrictMode>,
);
