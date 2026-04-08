import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2] === "firefox" ? "firefox" : "chrome";
const distDir = join(root, target === "firefox" ? "build-firefox" : "build-chrome");

const staticFiles = [
  ["src/popup/popup.html", "popup.html"],
  ["src/popup/popup.css", "popup.css"],
  ["src/options/options.html", "options.html"],
  ["src/options/options.css", "options.css"],
  ["public/icons/icon-16.png", "icons/icon-16.png"],
  ["public/icons/icon-32.png", "icons/icon-32.png"],
  ["public/icons/icon-48.png", "icons/icon-48.png"],
  ["public/icons/icon-128.png", "icons/icon-128.png"],
  ["public/fonts/space-grotesk-variable.woff2", "fonts/space-grotesk-variable.woff2"],
  ["public/fonts/OFL.txt", "fonts/OFL.txt"],
] as const;

const runtimeEntrypoints = [
  ["background", "main.js", "index.js"],
  ["content", "main.js", "index.js"],
  ["popup", "main.js", "index.js"],
  ["options", "main.js", "index.js"],
] as const;

const entrypoints = [
  "src/features/background/main.ts",
  "src/features/content/main.ts",
  "src/features/popup/main.ts",
  "src/features/options/main.ts",
].map((path) => join(root, path));

const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as { version?: string };
const manifestVersion = packageJson.version ?? "0.1.0";
const firefoxExtensionId = process.env.FILLO_FIREFOX_EXTENSION_ID?.trim();

const manifest = {
  manifest_version: 3,
  name: "Fillo",
  version: manifestVersion,
  description: "Save reusable values and fill Google Forms without auto-submitting.",
  icons: {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  },
  permissions: ["storage", "activeTab", "scripting"],
  host_permissions: ["https://docs.google.com/forms/*", "https://forms.gle/*"],
  action: {
    default_title: "Fillo",
    default_popup: "popup.html",
    default_icon: {
      16: "icons/icon-16.png",
      32: "icons/icon-32.png",
      48: "icons/icon-48.png",
    },
  },
  options_page: "options.html",
  content_scripts: [
    {
      matches: ["https://docs.google.com/forms/*"],
      js: ["content/index.js"],
      run_at: "document_idle",
    },
  ],
};

const browserManifest =
  target === "firefox"
    ? {
        ...manifest,
        background: {
          scripts: ["background/index.js"],
          type: "module",
        },
        ...(firefoxExtensionId
          ? {
              browser_specific_settings: {
                gecko: {
                  id: firefoxExtensionId,
                },
              },
            }
          : {}),
      }
    : {
        ...manifest,
        background: {
          service_worker: "background/index.js",
          type: "module",
        },
      };

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const buildResult = await Bun.build({
  entrypoints,
  outdir: distDir,
  target: "browser",
  format: "esm",
  naming: "[dir]/[name].[ext]",
  sourcemap: "linked",
  minify: false,
});

if (!buildResult.success) {
  for (const log of buildResult.logs) {
    console.error(log);
  }
  process.exit(1);
}

for (const [from, to] of staticFiles) {
  const destination = join(distDir, to);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(join(root, from), destination);
}

for (const [folder, sourceName, targetName] of runtimeEntrypoints) {
  const sourcePath = join(distDir, folder, sourceName);
  const targetPath = join(distDir, folder, targetName);
  const bundledCode = await readFile(sourcePath, "utf8");
  await writeFile(targetPath, bundledCode.replace(/sourceMappingURL=main\.js\.map/g, "sourceMappingURL=index.js.map"), "utf8");

  const sourceMapPath = join(distDir, folder, `${sourceName}.map`);
  const targetMapPath = join(distDir, folder, `${targetName}.map`);
  const sourceMap = await readFile(sourceMapPath, "utf8");
  await writeFile(targetMapPath, sourceMap, "utf8");
  await rm(sourcePath, { force: true });
  await rm(sourceMapPath, { force: true });
}

await writeFile(join(distDir, "manifest.json"), JSON.stringify(browserManifest, null, 2), "utf8");

console.log(`Built ${target} extension to ${distDir}`);
