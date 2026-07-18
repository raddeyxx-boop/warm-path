const fs = require("fs");

const path = require("path");

function loadTargetProfile() {

    const filePath = path.join(
        path.resolve(process.env.WARM_PATH_RUN_DIR || path.join(__dirname, "..", "data")),
        "target.json"
    );

    return JSON.parse(

        fs.readFileSync(

            filePath,

            "utf8"

        )

    );

}

module.exports = {
    loadTargetProfile
};
