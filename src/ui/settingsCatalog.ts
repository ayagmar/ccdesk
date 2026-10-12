import { valuesIn } from "../view/settings.ts";
import { reference } from "./reference.ts";

export function documentedValues(key: string): string[] {
  return valuesIn(reference().catalog.find((s) => s.key === key)?.type ?? "");
}
