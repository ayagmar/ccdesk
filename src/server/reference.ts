import HOOK_EVENTS from "../shared/hook-events.json" with { type: "json" };
import catalog from "../shared/settings-catalog.json" with { type: "json" };
import schema from "../shared/settings.schema.json" with { type: "json" };
import { type CatalogSetting, type Reference, type SettingSchema } from "../shared/types.ts";

/** Claude Code's settings data a front end edits against, from the files generated into src/shared. */
export const REFERENCE: Reference = {
  schemaSource: schema.$comment,
  settings: schema.definitions.ClaudeCodeSettings.properties as Record<string, SettingSchema>,
  catalog: Object.entries(catalog.keys as Record<string, Omit<CatalogSetting, "key">>).map(
    ([key, entry]) => ({ key, ...entry })
  ),
  hookEvents: HOOK_EVENTS,
};
