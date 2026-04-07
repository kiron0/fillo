import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("build script", () => {
  it("copies static assets from public and removes intermediate main bundles", async () => {
    const buildScript = await readFile(join(process.cwd(), "scripts", "build.ts"), "utf8");

    expect(buildScript).toContain('["public/icons/icon-128.png", "icons/icon-128.png"]');
    expect(buildScript).toContain('["public/fonts/space-grotesk-variable.woff2", "fonts/space-grotesk-variable.woff2"]');
    expect(buildScript).toContain("await rm(sourcePath, { force: true });");
    expect(buildScript).toContain("await rm(sourceMapPath, { force: true });");
  });
});
