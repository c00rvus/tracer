import { createWriteStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import extractZip from "extract-zip";

interface CreateArchiveInput {
  sessionRoot: string;
  destinationZipPath: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function includePathIfExists(
  archive: archiver.Archiver,
  absolutePath: string,
  archivePath: string
): Promise<void> {
  if (!(await exists(absolutePath))) {
    return;
  }
  const fileStat = await stat(absolutePath);
  if (fileStat.isDirectory()) {
    archive.directory(absolutePath, archivePath);
  } else {
    archive.file(absolutePath, { name: archivePath });
  }
}

export async function createSessionArchive({
  sessionRoot,
  destinationZipPath
}: CreateArchiveInput): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destinationZipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    output.on("error", (error) => reject(error));
    archive.on("error", (error) => reject(error));

    archive.pipe(output);

    const tasks = Promise.all([
      includePathIfExists(archive, path.join(sessionRoot, "manifest.json"), "manifest.json"),
      includePathIfExists(archive, path.join(sessionRoot, "events.ndjson"), "events.ndjson"),
      includePathIfExists(archive, path.join(sessionRoot, "screenshots"), "screenshots"),
      includePathIfExists(archive, path.join(sessionRoot, "network"), "network"),
      includePathIfExists(archive, path.join(sessionRoot, "meta"), "meta")
    ]);

    tasks
      .then(() => archive.finalize())
      .catch((error) => reject(error));
  });
}

export async function extractSessionArchive(
  zipPath: string,
  extractTo: string
): Promise<void> {
  await extractZip(zipPath, { dir: extractTo });
}
