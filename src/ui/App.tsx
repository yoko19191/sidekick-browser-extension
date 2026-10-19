import { useEffect, useState } from "react";
import { ChatView } from "./ChatView";
import { useProviders, useSettings, useTheme } from "./hooks";
import { SettingsStack, type Route } from "./pages/Settings";

export function App() {
  const { settings, update } = useSettings();
  const providers = useProviders();
  const [stack, setStack] = useState<Route[]>(() => {
    const r = new URLSearchParams(location.search).get("route");
    return r ? (["settings", ...(r === "settings" ? [] : [r])] as Route[]) : [];
  });
  useTheme(settings.theme);

  const push = (r: Route) => setStack((s) => [...s, r]);
  const pop = () => setStack((s) => s.slice(0, -1));
  const openSettings = (...routes: Route[]) => setStack(["settings", ...routes.filter((r) => r !== "settings")]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && stack.length && pop();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stack.length]);

  return (
    <div className="relative h-full overflow-hidden">
      <div className={stack.length ? "invisible" : ""}>
        <ChatView settings={settings} providers={providers.providers} masked={providers.masked} openSettings={openSettings} />
      </div>
      {stack.length > 0 && (
        <div className="absolute inset-0 z-20 bg-[#f6f6f8] dark:bg-[#111114]">
          <SettingsStack key={stack.join("/")} stack={stack} push={push} pop={pop} close={() => setStack([])} settings={settings} update={update} providers={providers} />
        </div>
      )}
    </div>
  );
}
