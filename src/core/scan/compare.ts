import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  type ComparedSetting,
  type ComparedValue,
  type SettingsComparison,
} from "../../shared/compare.ts";
import { type ScanEnv } from "./env.ts";
import { effectiveSettings, readSettingsLayers } from "./settings.ts";

/** Each key Claude Code applies in `dir`, with its value and the files it comes from. */
async function valuesIn(env: ScanEnv, dir: string): Promise<Map<string, ComparedValue>> {
  const layers = await readSettingsLayers(env, dir);
  const values = new Map<string, ComparedValue>();
  for (const setting of effectiveSettings(layers)) {
    // A key every file sets where Claude Code does not read it applies nowhere.
    if (setting.from.length === 0) continue;
    const sources = setting.from.flatMap((scope) => {
      const layer = layers.find((l) => l.scope === scope && l.data?.[setting.key] !== undefined);
      return layer ? [{ scope, path: layer.path }] : [];
    });
    values.set(setting.key, { value: setting.value, sources });
  }
  return values;
}

/**
 * The effective settings of two directories side by side. Values are compared as ccdesk shows
 * them, so hidden values stay hidden and two of them count as the same.
 */
export async function compareSettings(
  env: ScanEnv,
  a: string,
  b: string
): Promise<SettingsComparison> {
  const [left, right] = await Promise.all([valuesIn(env, resolve(a)), valuesIn(env, resolve(b))]);
  const keys = [...new Set([...left.keys(), ...right.keys()])].sort();
  const settings = keys.map((key): ComparedSetting => {
    const x = left.get(key) ?? null;
    const y = right.get(key) ?? null;
    // The order keys are written in does not change a setting.
    return { key, a: x, b: y, same: isDeepStrictEqual(x?.value, y?.value) };
  });
  return { a: resolve(a), b: resolve(b), settings };
}
