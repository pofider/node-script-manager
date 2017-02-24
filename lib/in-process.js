var ScriptsManager = module.exports = function (options) {
  this.options = options
  this.options.timeout = this.options.timeout || 10000
}

ScriptsManager.prototype.start = function (cb) {
  cb()
}

ScriptsManager.prototype.ensureStarted = function (cb) {
  cb()
}

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  var resolved = false

  var timeout = setTimeout(function () {
    cb(new Error('Timeout error during executing script'))
  }, options.timeout || this.options.timeout)

  timeout.unref()

  require(options.execModulePath)(inputs, options.callback, function (err, res) {
    if (resolved) {
      return
    }

    resolved = true
    clearTimeout(timeout)

    cb(err, res)
  })
}

ScriptsManager.prototype.kill = function () {
}
