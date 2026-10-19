import { Mascot } from "../mascot/Mascot";
/** 翻翻 Sidekick mark: the mascot, static (onboarding / options headers). */
export function Logo({ size = 26 }: { size?: number }) {
  return <Mascot state="idle" still size={size} />;
}
