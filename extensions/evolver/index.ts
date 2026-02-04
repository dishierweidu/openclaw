import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createEvolverTool } from "./src/evolver-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(
    (ctx) => {
      // Only allow in non-sandboxed environments
      if (ctx.sandboxed) {
        return null;
      }
      return createEvolverTool(api);
    },
    { optional: true },
  );
}
