import { useEffect, useState } from "react";
import { ChatView } from "./ChatView";
import { ToastProvider } from "./components/ui";
import { useProviders, useSettings, useTheme } from "./hooks";
import { Onboarding } from "./Onboarding";

export const ONBOARDING_KEY = "onboardingDone";

export function App() {
  const { settings, update, loaded } = useSettings();
  const providers = useProviders();
  const [onboarding, setOnboarding] = useState<boolean | null>(null);
  useTheme(settings.theme);

  useEffect(() => {
    chrome.storage.local.get(ONBOARDING_KEY).then((r) => setOnboarding(!r[ONBOARDING_KEY] && new URLSearchParams(location.search).get("onboarding") !== "0"));
  }, []);
  const finish = () => {
    chrome.storage.local.set({ [ONBOARDING_KEY]: true });
    setOnboarding(false);
  };

  return (
    <ToastProvider>
      <div className="relative h-full overflow-hidden">
        <ChatView settings={settings} update={update} providers={providers.providers} masked={providers.masked} onSetup={() => setOnboarding(true)} />
        {loaded && onboarding && providers.loaded && (
          <div className="absolute inset-0 z-30 bg-background">
            <Onboarding settings={settings} update={update} providers={providers} onDone={finish} />
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
