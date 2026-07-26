const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

function tempPathFor(filePath) {
    const directory = path.dirname(filePath);
    const base = path.basename(filePath);
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return path.join(directory, `.${base}.${suffix}.tmp`);
}

function jsonText(value) {
    return JSON.stringify(value, null, 2) + "\n";
}

function ensureParentDirectorySync(filePath) {
    fs.mkdirSync(path.dirname(filePath), {
        recursive: true
    });
}

async function ensureParentDirectory(filePath) {
    await fsp.mkdir(path.dirname(filePath), {
        recursive: true
    });
}

function writeJsonAtomicSync(filePath, value) {
    ensureParentDirectorySync(filePath);
    const tempPath = tempPathFor(filePath);

    try {
        fs.writeFileSync(tempPath, jsonText(value), "utf8");
        fs.renameSync(tempPath, filePath);
    } catch (err) {
        try {
            if (fs.existsSync(tempPath)) {
                fs.unlinkSync(tempPath);
            }
        } catch (cleanupErr) {
            console.warn("[JsonFileStore.writeJsonAtomicSync] Temporary-file cleanup failed.", {
                tempPath,
                reason: cleanupErr.message
            });
        }

        throw err;
    }
}

async function writeJsonAtomic(filePath, value) {
    await ensureParentDirectory(filePath);
    const tempPath = tempPathFor(filePath);

    try {
        await fsp.writeFile(tempPath, jsonText(value), "utf8");
        await fsp.rename(tempPath, filePath);
    } catch (err) {
        await fsp.unlink(tempPath).catch(() => {});
        throw err;
    }
}

module.exports = {
    writeJsonAtomic,
    writeJsonAtomicSync
};
