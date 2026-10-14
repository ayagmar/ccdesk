import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type ComparedSetting,
  type ComparedValue,
  type SettingsComparison,
} from "../../shared/compare.ts";
import { type ScanEnv } from "./env.ts";
import {
  effectiveSettings,
  readManagedSettings,
  readSettingsLayers,
  unredactedData,
} from "./settings.ts";

/**
 * Each key Claude Code applies in `dir`: its value as ccdesk shows it, with the files it comes from,
 * and as the files have it, which is only compared and never shown.
 */
async function valuesIn(
  env: ScanEnv,
  dir: string
): Promise<Map<string, { shown: ComparedValue; written: unknown }>> {
  const layers = await readSettingsLayers(env, dir, await readManagedSettings(env));
  const written = new Map(
    effectiveSettings(layers.map((l) => ({ ...l, data: unredactedData(l) ?? l.data }))).map((s) => [
      s.key,
      s.value,
    ])
  );
  const values = new Map<string, { shown: ComparedValue; written: unknown }>();
  for (const setting of effectiveSettings(layers)) {
    // A key every file sets where Claude Code does not read it applies nowhere.
    if (setting.from.length === 0) continue;
    const sources = setting.from.flatMap((scope) => {
      const layer = layers.find((l) => l.scope === scope && l.data?.[setting.key] !== undefined);
      return layer ? [{ scope, path: layer.path }] : [];
    });
    values.set(setting.key, {
      shown: { value: setting.value, sources },
      written: written.get(setting.key),
    });
  }
  return values;
}

/**
 * The effective settings of two directories side by side. Values are compared as the files have
 * them, so two different hidden values are not the same, though neither is shown.
 */
export async function compareSettings(
  env: ScanEnv,
  a: string,
  b: string
): Promise<SettingsComparison> {
  const [left, right] = await Promise.all([valuesIn(env, resolve(a)), valuesIn(env, resolve(b))]);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const settings = keys.map((key): ComparedSetting => {
    const x = left.get(key);
    const y = right.get(key);
    // The order keys are written in does not change a setting.
    const same = isDeepStrictEqual(x?.written, y?.written);
    const setting: ComparedSetting = { key, a: x?.shown ?? null, b: y?.shown ?? null, same };
    if (!same && x && y && isDeepStrictEqual(x.shown.value, y.shown.value))
      setting.hiddenDiffers = true;
    return setting;
  });
  return { a: resolve(a), b: resolve(b), settings };
}
