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
  var self
  var resolved = false

  var timeout = setTimeout(function () {
    resolved = true
    cb(new Error('Timeout error during executing script'))
  }, options.timeout || this.options.timeout)

  timeout.unref()

  require(options.execModulePath)(inputs, function () {
    if (resolved) {
      return
    }

    var params = Array.prototype.slice.call(arguments)
    var originalCbRespond = params.pop()

    params.push(function () {
      if (resolved) {
        return
      }

      var args = Array.prototype.slice.call(arguments)
      originalCbRespond.apply(undefined, args)
    })

    options.callback.apply(self, params)
  }, function (err, res) {
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
