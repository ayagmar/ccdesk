import { type SettingSchema } from "../shared/types.ts";
import { reference } from "./reference.ts";

export function schemaSource(): string {
  return reference().schemaSource;
}

export function settingKeys(): string[] {
  return Object.keys(reference().settings).sort();
}

export function propertyFor(key: string): SettingSchema | undefined {
  return reference().settings[key];
}
