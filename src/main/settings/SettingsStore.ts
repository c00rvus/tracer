import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { app } from "electron";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "../../shared/settings";
import type { AppSettings } from "../../shared/types";
import { ensureDir } from "../session/utils";

interface StoredSettingsFile {
  version: number;
  settings: AppSettings;
}

const SETTINGS_FILE_VERSION = 1;

export class SettingsStore {
  private readonly filePath: string;
  private readonly fallbackSaveDir: string;
  private settings: AppSettings = { ...DEFAULT_APP_SETTINGS };

  constructor() {
    this.filePath = path.join(app.getPath("userData"), "settings.json");
    this.fallbackSaveDir = path.join(app.getPath("documents"), "TracerSessions");
  }

  public async load(): Promise<AppSettings> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      this.settings = this.withResolvedDefaults(
        normalizeAppSettings(this.extractSettingsPayload(parsed))
      );
      await this.persist();
    } catch {
      this.settings = this.withResolvedDefaults({ ...DEFAULT_APP_SETTINGS });
      await this.persist();
    }
    return this.get();
  }

  public get(): AppSettings {
    return { ...this.settings };
  }

  public async update(settings: AppSettings): Promise<AppSettings> {
    this.settings = this.withResolvedDefaults(normalizeAppSettings(settings));
    await this.persist();
    return this.get();
  }

  private async persist(): Promise<void> {
    await ensureDir(path.dirname(this.filePath));
    const payload: StoredSettingsFile = {
      version: SETTINGS_FILE_VERSION,
      settings: this.settings
    };
    await writeFile(this.filePath, JSON.stringify(payload, null, 2), "utf8");
  }

  private extractSettingsPayload(input: unknown): Partial<AppSettings> | null {
    if (!input || typeof input !== "object") {
      return null;
    }

    const record = input as Record<string, unknown>;
    const nested = record.settings;
    if (nested && typeof nested === "object") {
      return nested as Partial<AppSettings>;
    }

    return record as Partial<AppSettings>;
  }

  private withResolvedDefaults(settings: AppSettings): AppSettings {
    if (settings.defaultSessionSaveDir.trim().length > 0) {
      return settings;
    }

    return {
      ...settings,
      defaultSessionSaveDir: this.fallbackSaveDir
    };
  }
}
