import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("build script", () => {
  it("copies static assets from public, removes intermediate main bundles, and supports Firefox manifests", async () => {
    const buildScript = await readFile(join(process.cwd(), "scripts", "build.ts"), "utf8");

    expect(buildScript).toContain('const target = process.argv[2] === "firefox" ? "firefox" : "chrome";');
    expect(buildScript).toContain('const distDir = join(root, target === "firefox" ? "build-firefox" : "build-chrome");');
    expect(buildScript).toContain('["public/icons/icon-128.png", "icons/icon-128.png"]');
    expect(buildScript).toContain('["public/fonts/space-grotesk-variable.woff2", "fonts/space-grotesk-variable.woff2"]');
    expect(buildScript).toContain('scripts: ["background/index.js"]');
    expect(buildScript).toContain('service_worker: "background/index.js"');
    expect(buildScript).toContain("FILLO_FIREFOX_EXTENSION_ID");
    expect(buildScript).toContain("await rm(sourcePath, { force: true });");
    expect(buildScript).toContain("await rm(sourceMapPath, { force: true });");
  });
});
