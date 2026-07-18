const path = require("path");

const {
    writeJsonAtomicSync
} = require("./JsonFileStore");

function saveTargetProfile(profile) {

    const filePath = path.join(
        path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data")),
        "target.json"
    );

    writeJsonAtomicSync(filePath, profile);

}

module.exports = {
    saveTargetProfile
};
