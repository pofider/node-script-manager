module.exports = function(options) {
    return new (require("./lib/manager.js"))(options);
};

module.exports.ScriptManager = require("./lib/manager.js");