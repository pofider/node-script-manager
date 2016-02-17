var ScriptsManager = module.exports = function (options) {
};


ScriptsManager.prototype.start = function (cb) {
  cb();
};

ScriptsManager.prototype.ensureStarted = function (cb) {
  cb();
};

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  require(options.execModulePath)(inputs, options.callback, cb);
};

ScriptsManager.prototype.kill = function () {
};


