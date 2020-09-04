/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * TaskManager responsible for running async tasks.
 * It's using cluster on http server to load balance work and also provides
 * timout handling
 */

var childProcess = require('child_process')
var path = require('path')
var uuid = require('uuid').v4
var axios = require('axios')
var getRandomPort = require('./getRandomPort')
var messageHandler = require('./messageHandler')

var findFreePort = function (host, cb) {
  getRandomPort({
    host: host
  }, cb)
}

var findFreePortInRange = function (host, portLeftBoundary, portRightBoundary, cb) {
  getRandomPort({
    min: portLeftBoundary,
    max: portRightBoundary,
    host: host
  }, cb)
}

var ScriptsManager = module.exports = function (options) {
  this.options = options
  this.options.timeout = this.options.timeout || 10000
  this.options.numberOfWorkers = this.options.numberOfWorkers || 1
  this.options.host = this.options.host || '127.0.0.1'
  this._runningRequests = []

  var self = this

  process.once('exit', function () {
    self.kill()
  })

  if (this.options.portLeftBoundary && this.options.portRightBoundary) {
    this.findFreePort = function (cb) {
      findFreePortInRange(self.options.host, self.options.portLeftBoundary, self.options.portRightBoundary, cb)
    }
  } else {
    this.findFreePort = function (cb) {
      findFreePort(self.options.host, cb)
    }
  }
}

ScriptsManager.prototype.start = function (cb) {
  var self = this

  this.findFreePort(function (err, port) {
    if (err) {
      return cb(err)
    }

    self.options.port = port

    var forkOptions = self.options.forkOptions || {}
    forkOptions.env = Object.assign({}, process.env, forkOptions.env || {})

    self.workersClusterId = uuid()

    forkOptions.env['SCRIPT_MANAGER_WORKERS_CLUSTER_ID'] = self.workersClusterId

    self.workersCluster = childProcess.fork(path.join(__dirname, 'worker-servers.js'), forkOptions)

    self.workersCluster.on('exit', function () {
      // manual kill
      if (!self.isStarted) {
        return
      }

      self.start(function () {

      })
    })

    self.workersCluster.on('message', function (rawM) {
      var m = messageHandler.parse(rawM)

      if (m.action === 'running') {
        self.isStarted = true
        cb()
      }
    })

    self.workersCluster.on('message', function (rawM) {
      var m = messageHandler.parse(rawM)
      var reqOptions

      if (m.action === 'callback') {
        reqOptions = self._runningRequests.find(r => r.rid === m.rid)

        if (!reqOptions || reqOptions.isDone) {
          return
        }

        m.params.push(function () {
          if (reqOptions.isDone) {
            return
          }

          var args = Array.prototype.slice.call(arguments)

          if (args.length && args[0]) {
            args[0] = args[0].message
          }

          self.workersCluster.send(messageHandler.serialize({
            action: 'callback-response',
            cid: m.cid,
            rid: m.rid,
            params: args
          }))
        })

        reqOptions.callback.apply(self, m.params)
      }

      if (m.action === 'register') {
        reqOptions = self._runningRequests.find(r => r.rid === m.rid)

        if (!reqOptions) {
          return
        }

        var timeoutValue = reqOptions.timeout || self.options.timeout

        if (timeoutValue !== -1) {
          // TODO we should actually kill only the script that caused timeout and resend other requests from the same worker... some more complicated logic is required here
          reqOptions.timeoutRef = setTimeout(function () {
            if (reqOptions.isDone) {
              return
            }

            reqOptions.isDone = true

            self.workersCluster.send(messageHandler.serialize({
              action: 'kill',
              rid: reqOptions.rid
            }))

            var error = new Error()
            error.weak = true
            error.message = reqOptions.timeoutErrorMessage || 'Timeout error during executing script'

            self._runningRequests = self._runningRequests.filter(r => r.rid !== reqOptions.rid)

            reqOptions.cb(error)
          }, timeoutValue)
        }

        if (reqOptions.timeoutRef) {
          reqOptions.timeoutRef.unref()
        }
      }
    })

    self.workersCluster.send(messageHandler.serialize({
      action: 'start',
      port: self.options.port,
      host: self.options.host,
      inputRequestLimit: self.options.inputRequestLimit || 200e6,
      numberOfWorkers: self.options.numberOfWorkers
    }))
  })
}

ScriptsManager.prototype.ensureStarted = function (cb) {
  if (this.isStarted) {
    return cb()
  }

  // TODO we should probably make lock here to avoid multiple node.exe processes in parallel init
  this.start(cb)
}

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  var self = this

  options.wcid = self.workersClusterId
  options.rid = options.rid = uuid()
  options.isDone = false
  options.cb = cb

  var body = {
    inputs: inputs,
    options: options
  }

  this._runningRequests.push(options)

  function handleResponse (err, response) {
    if (options.timeoutRef) {
      clearTimeout(options.timeoutRef)
    }

    if (options.isDone) {
      return
    }

    options.isDone = true

    self._runningRequests = self._runningRequests.filter(r => r.rid !== options.rid)

    if (err) {
      return cb(err)
    }

    var body = messageHandler.parse(response.data)

    if (!body) {
      return cb(new Error('Something went wrong in communication with internal scripting server. You may try to change scripting strategy from `http-server` to `dedicated-process`.'))
    }

    if (body.error && response.status !== 200) {
      var e = new Error()
      e.message = body.error.message
      e.stack = body.error.stack
      e.weak = true
      return cb(e)
    }

    cb(null, body)
  }

  axios({
    method: 'post',
    url: 'http://' + this.options.host + ':' + this.options.port,
    headers: {
      'Content-Type': 'application/json'
    },
    // disable request/response body limit, don't throw on large payload response, or when the post body is large
    // https://github.com/axios/axios/issues/2696
    maxContentLength: Infinity,
    data: messageHandler.serialize(body),
    // we don't want any parsing in the response data, we want the raw form (string)
    transformResponse: []
  }).then((response) => {
    handleResponse(null, response)
  }).catch(err => {
    if (err.response) {
      handleResponse(null, err.response)
    } else {
      handleResponse(err)
    }
  })
}

ScriptsManager.prototype.kill = function () {
  if (this.workersCluster) {
    this.isStarted = false
    this.workersCluster.kill()
  }
}
