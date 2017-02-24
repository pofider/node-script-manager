/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * TaskManager responsible for running async tasks.
 * It's using cluster on http server to load balance work and also provides
 * timout handling
 */

var childProcess = require('child_process')
var path = require('path')
var uuid = require('uuid').v1
var request = require('request')
var _ = require('underscore')
var cluster = require('cluster')
var netCluster = require('net-cluster')
var portScanner = require('portscanner')

var findFreePort = function (host, cb) {
  var server = netCluster.createServer()
  var port = 0

  server.on('listening', function () {
    port = server.address().port
    server.close()
  })

  server.on('close', function () {
    cb(null, port)
  })

  server.listen(0, host)
}

var findFreePortInRange = function (host, portLeftBoundary, portRightBoundary, cb) {
  // in cluster we don't want ports to collide, so we make a special space for every worker assuming max number of cluster workers is 5
  if (cluster.worker) {
    portLeftBoundary = portLeftBoundary + (((portRightBoundary - portLeftBoundary) / 5) * (cluster.worker.id - 1))
  }

  portScanner.findAPortNotInUse(portLeftBoundary, portRightBoundary, host, function (error, port) {
    cb(error, port)
  })
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

    self.workersCluster = childProcess.fork(path.join(__dirname, 'worker-servers.js'), self.options.forkOptions || {})

    self.workersCluster.on('exit', function () {
      // manual kill
      if (!self.isStarted) {
        return
      }

      self.start(function () {

      })
    })

    self.workersCluster.on('message', function (m) {
      if (m.action === 'running') {
        self.isStarted = true
        cb()
      }
    })

    self.workersCluster.on('message', function (m) {
      var reqOptions

      if (m.action === 'callback') {
        reqOptions = _.findWhere(self._runningRequests, { rid: m.rid })

        m.params.push(function () {
          var args = Array.prototype.slice.call(arguments)

          if (args.length && args[0]) {
            args[0] = args[0].message
          }
          self.workersCluster.send({
            action: 'callback-response',
            rid: m.rid,
            params: args
          })
        })

        reqOptions.callback.apply(self, m.params)
      }

      if (m.action === 'register') {
        reqOptions = _.findWhere(self._runningRequests, { rid: m.rid })

        if (!reqOptions) {
          return
        }

        // TODO we should actually kill only the script that caused timeout and resend other requests from the same worker... some more complicated logic is required here
        reqOptions.timeoutRef = setTimeout(function () {
          if (reqOptions.isDone) {
            return
          }

          reqOptions.isDone = true
          self.workersCluster.send({ action: 'kill', rid: reqOptions.rid })

          var error = new Error()
          error.weak = true
          error.message = 'Timeout'

          self._runningRequests = _.without(self._runningRequests, _.findWhere(self._runningRequests, {rid: reqOptions.rid}))

          reqOptions.cb(error)
        }, reqOptions.timeout || self.options.timeout).unref()
      }
    })

    self.workersCluster.send({
      action: 'start',
      port: self.options.port,
      host: self.options.host,
      inputRequestLimit: self.options.inputRequestLimit || 200e6,
      numberOfWorkers: self.options.numberOfWorkers
    })
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

  options.rid = options.rid = uuid()
  options.isDone = false
  options.cb = cb

  var body = {
    inputs: inputs,
    options: options
  }

  this._runningRequests.push(options)

  request({
    method: 'POST',
    url: 'http://' + this.options.host + ':' + this.options.port,
    body: body,
    json: true
  }, function (err, httpResponse, body) {
    if (options.timeoutRef) {
      clearTimeout(options.timeoutRef)
    }

    if (options.isDone) {
      return
    }

    options.isDone = true

    self._runningRequests = _.without(self._runningRequests, _.findWhere(self._runningRequests, {rid: options.rid}))

    if (err) {
      return cb(err)
    }

    if (!body) {
      return cb(new Error('Something went wrong in communication with internal scripting server. You may try to change scripting strategy from `http-server` to `dedicated-process`.'))
    }

    if (body.error) {
      var e = new Error()
      e.message = body.error.message
      e.stack = body.error.stack
      e.weak = true
      return cb(e)
    }

    cb(null, body)
  })
}

ScriptsManager.prototype.kill = function () {
  if (this.workersCluster) {
    this.isStarted = false
    this.workersCluster.kill()
  }
}
