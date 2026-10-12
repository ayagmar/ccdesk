import { type Scope } from "./types.ts";

/** The value a key has in one directory, and the settings files it comes from. */
export interface ComparedValue {
  /** As ccdesk shows it, with hidden values as •••. */
  value: unknown;
  /** The files that decide it, lowest precedence first; several when lists or objects are combined. */
  sources: Array<{ scope: Scope; path: string }>;
}

export interface ComparedSetting {
  key: string;
  /** Null where no settings file Claude Code reads there sets the key. */
  a: ComparedValue | null;
  b: ComparedValue | null;
  /** Whether both have the same value as ccdesk shows it; two hidden values count as the same. */
  same: boolean;
}

/** The effective settings of two directories, key by key. */
export interface SettingsComparison {
  a: string;
  b: string;
  settings: ComparedSetting[];
}
