import { WindowIsMaximised, WindowMinimise, WindowToggleMaximise, Quit, EventsOn } from "../../wailsjs/runtime";
import { Close, Ready } from "../../wailsjs/go/app/App";

const appWindow = {
  isMaximized: WindowIsMaximised,
  minimize: WindowMinimise,
  toggleMaximize: WindowToggleMaximise,
  close: Quit,
  destroy: () => { void Close(); },
  async onCloseRequested(handler: (e: { preventDefault: () => void }) => void) {
    const off = EventsOn("app:close-requested", () => {
      let prevented = false;
      handler({ preventDefault: () => { prevented = true; } });
      if (!prevented) void Close();
    });
    try {
      await Ready();
      return off;
    } catch (error) {
      off();
      throw error;
    }
  },
  async onResized(handler: () => void) {
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  },
};

export const getCurrentWindow = () => appWindow;
