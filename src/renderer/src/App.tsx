import { useMemo } from "react";
import LiveApp from "./components/LiveApp";

/**
 * Root renderer entry that decides which Electron window mode to render.
 */
export default function App() {
  const windowMode = useMemo(() => {
    const mode = new URLSearchParams(window.location.search).get("window");
    if (mode === "settings") {
      return mode;
    }
    return "dashboard";
  }, []);

  return <LiveApp windowMode={windowMode} />;
}
