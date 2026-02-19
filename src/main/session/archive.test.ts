import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSessionArchive, extractSessionArchive } from "./archive";
import { ensureDir } from "./utils";

describe("archive", () => {
  it("creates and extracts a session archive with expected files", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tracer-archive-root-"));
    const output = await mkdtemp(path.join(os.tmpdir(), "tracer-archive-out-"));
    const extract = await mkdtemp(path.join(os.tmpdir(), "tracer-archive-extract-"));

    try {
      await ensureDir(path.join(root, "screenshots"));
      await ensureDir(path.join(root, "network", "bodies"));
      await ensureDir(path.join(root, "meta"));

      await writeFile(path.join(root, "manifest.json"), JSON.stringify({ sessionId: "abc", createdAt: 1 }), "utf8");
      await writeFile(path.join(root, "events.ndjson"), '{"id":"1"}\n', "utf8");
      await writeFile(path.join(root, "screenshots", "a.png"), "image", "utf8");
      await writeFile(path.join(root, "network", "bodies", "body.bin"), "body", "utf8");
      await writeFile(path.join(root, "meta", "version.json"), '{"schemaVersion":"1.0.0"}', "utf8");

      const zipPath = path.join(output, "session.zip");
      await createSessionArchive({
        sessionRoot: root,
        destinationZipPath: zipPath
      });

      await extractSessionArchive(zipPath, extract);

      const manifestRaw = await readFile(path.join(extract, "manifest.json"), "utf8");
      const imageRaw = await readFile(path.join(extract, "screenshots", "a.png"), "utf8");

      expect(manifestRaw.includes('"sessionId":"abc"')).toBe(true);
      expect(imageRaw).toBe("image");
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(output, { recursive: true, force: true });
      await rm(extract, { recursive: true, force: true });
    }
  });
});
