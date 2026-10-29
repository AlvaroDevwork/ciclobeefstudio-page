import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PREFIXES = Object.freeze([
    ".github/",
    ".playwright-mcp/",
    "ai-log/",
    "audits/",
    "config/",
    "playwright-report/",
    "scripts/",
    "src/",
    "technical/",
    "test-results/",
    "tests/",
]);

const FORBIDDEN_EXACT_PATHS = new Set([
    "business/ciclobeef-basic-landing-value-proposition.md",
    "business/ciclobeef-basic-landing-value-proposition/index.html",
]);

const FORBIDDEN_BASENAMES = new Set([
    ".DS_Store",
    ".env",
    "credentials",
    "credentials.json",
]);

const FORBIDDEN_EXTENSIONS = new Set([".key", ".pem"]);

function normalize(relativePath) {
    return relativePath.split(path.sep).join("/");
}

function isForbidden(relativePath) {
    const normalized = normalize(relativePath);
    const basename = path.posix.basename(normalized);

    return FORBIDDEN_EXACT_PATHS.has(normalized)
        || FORBIDDEN_PREFIXES.some(prefix => normalized.startsWith(prefix))
        || FORBIDDEN_BASENAMES.has(basename)
        || basename.startsWith(".env.")
        || FORBIDDEN_EXTENSIONS.has(path.posix.extname(basename).toLowerCase());
}

async function inventory(root, current = root) {
    const entries = await readdir(current, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const absolutePath = path.join(current, entry.name);
        const relativePath = normalize(path.relative(root, absolutePath));

        if (entry.isSymbolicLink()) {
            files.push({ relativePath, symbolicLink: true });
        } else if (entry.isDirectory()) {
            files.push(...await inventory(root, absolutePath));
        } else if (entry.isFile()) {
            files.push({ relativePath, symbolicLink: false });
        }
    }

    return files;
}

export async function findForbiddenPublicationFiles(siteDirectory) {
    const root = await realpath(siteDirectory);
    const metadata = await stat(root);
    if (!metadata.isDirectory()) {
        throw new Error(`Publication artifact is not a directory: ${siteDirectory}`);
    }

    return (await inventory(root))
        .filter(entry => entry.symbolicLink || isForbidden(entry.relativePath))
        .map(entry => entry.relativePath)
        .sort();
}

async function main() {
    const siteDirectory = process.argv[2] || "site";
    let forbiddenFiles;

    try {
        forbiddenFiles = await findForbiddenPublicationFiles(siteDirectory);
    } catch (error) {
        console.error(`Publication boundary validation failed: ${error.message}`);
        process.exitCode = 1;
        return;
    }

    if (forbiddenFiles.length > 0) {
        console.error("Publication boundary violation:");
        for (const filename of forbiddenFiles) console.error(filename);
        process.exitCode = 1;
        return;
    }

    console.log("Publication boundary validation passed.");
}

const invokedAsScript = process.argv[1]
    && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsScript) await main();
