import { useSettings } from "../state/settings";
import { MoonIcon, SunIcon } from "./icons";

/** Bascule thème sombre / clair (mémorisée dans les réglages). */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Passer en thème clair" : "Passer en thème sombre";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setTheme(next)}
      className={`flex h-8 w-8 items-center justify-center rounded-md text-slate-400 hover:bg-slate-800 hover:text-slate-100 ${className}`}
    >
      {theme === "dark" ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
