/** Dev-only (e2e builds): sidepanel.html#mascot-gallery[&dark] renders every mascot expression for review/screenshots. */
import { MASCOT_STATES, Mascot } from "../mascot/Mascot";

export function MascotGallery() {
  return (
    <div className="min-h-full bg-background p-6 text-foreground" data-testid="mascot-gallery">
      <div className="grid grid-cols-5 gap-4">
        {MASCOT_STATES.map((s) => (
          <div key={s} className="flex flex-col items-center gap-3 rounded-card bg-card px-3 pb-3 pt-5">
            <Mascot state={s} size={88} hold />
            <div className="flex items-center gap-2">
              <Mascot state={s} size={22} hold />
              <code className="whitespace-nowrap text-[12.5px] text-muted-foreground">{s}</code>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
