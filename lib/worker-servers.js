/*!
 * Copyright(c) 2014 Jan Blaha
 *
 * http server cluster listening on dedicated work and executing specified tasks
 */

var cluster = require('cluster')
var _ = require('underscore')
var domain = require('domain')

var workers = []
var currentRequests = {}
var port
var host
var inputRequestLimit
var callbackRequests = {}

if (cluster.isMaster) {
  var isRunning = false

  cluster.on('fork', function (worker) {
    worker.pid = worker.process.pid
    worker.isRunning = false
    workers.push(worker)

    worker.process.on('message', function (m) {
      if (m.action === 'register') {
        var worker = _.findWhere(workers, { pid: m.pid })

        // maybe worker was recycled before it started? unlikely, but to be sure we don't crash the master
        if (worker) {
          currentRequests[m.rid] = worker

          process.send({
            action: 'register',
            rid: m.rid
          })
        }
      }

      if (m.action === 'completed') {
        delete currentRequests[m.rid]
      }

      if (m.action === 'callback') {
        process.send(m)
      }
    })

    worker.on('exit', function (w, code, signal) {
      workers = _.without(workers, _.findWhere(workers, {pid: worker.pid}))

      var keysToDelete = []

      for (var key in currentRequests) {
        if (currentRequests[key].pid === worker.pid) {
          keysToDelete.push(key)
        }
      }

      keysToDelete.forEach(function (k) {
        delete currentRequests[k]
      })

      cluster.fork()
    })

    worker.send({
      action: 'start',
      port: port,
      host: host,
      inputRequestLimit: inputRequestLimit
    })
  })

  cluster.on('listening', function (worker) {
    if (isRunning) {
      return
    }

    worker.isRunning = true

    if (!_.findWhere(workers, {isRunning: false})) {
      isRunning = true

      process.send({
        action: 'running'
      })
    }
  })

  process.on('message', function (m) {
    var worker

    if (m.action === 'kill') {
      worker = currentRequests[m.rid]

      if (worker) {
        worker.process.kill('SIGKILL')
      }
    }

    if (m.action === 'start') {
      port = m.port
      host = m.host
      inputRequestLimit = m.inputRequestLimit

      for (var i = 0; i < m.numberOfWorkers; i++) {
        cluster.fork()
      }
    }

    if (m.action === 'callback-response') {
      worker = currentRequests[m.rid]

      // worker could be recycled in the meantime
      if (worker) {
        worker.send(m)
      }
    }
  })
}

if (!cluster.isMaster) {
  var startListening = function (port, host) {
    var server = require('http').createServer(function (req, res) {
      // NOTE: we're still using domains here intentionally,
      // we have tried to avoid its usage but unfortunately there is no other way to
      // ensure that we are handling all kind of errors that can occur in an external script,
      // but everything is ok because node.js will only remove domains when they found an alternative
      // and when that time comes, we just need to migrate to that alternative.
      var d = domain.create()

      d.on('error', function (er) {
        try {
          // make sure we close down within 30 seconds
          var killtimer = setTimeout(function () {
            process.exit(1)
          }, 30000)

          // But don't keep the process open just for that!
          killtimer.unref()

          // stop taking new requests.
          server.close()

          // Let the master know we're dead.  This will trigger a
          // 'disconnect' in the cluster master, and then it will fork
          // a new worker.
          if (cluster) {
            cluster.worker.disconnect()
          }

          error(res, er)
        } catch (er2) {
          // oh well, not much we can do at this point.
          console.error('Error sending 500!', er2.stack)
        }
      })

      d.add(req)
      d.add(res)
      d.req = req

      d.run(function () {
        processRequest(req, res)
      })
    })

    server.listen(port, host)
  }

  process.on('message', function (m) {
    inputRequestLimit = m.inputRequestLimit

    if (m.action === 'start') {
      startListening(m.port, m.host)
    }

    if (m.action === 'callback-response') {
      callbackRequests[m.rid](m)
    }
  })
}

function error (res, err) {
  res.writeHead(500)

  res.end(JSON.stringify({
    error: {
      message: err.message,
      stack: err.stack
    }
  }))
}

function processRequest (req, res) {
  var body = ''

  req.on('data', function (data) {
    body += data

    if (body.length > inputRequestLimit) {
      error(res, new Error('Input request exceeded inputRequestLimit'))
      res.destroy()
    }
  })

  req.on('end', function () {
    req.body = JSON.parse(body)

    process.send({ action: 'register', rid: req.body.options.rid, pid: process.pid })

    try {
      var callback = function () {
        var cb = arguments[arguments.length - 1]

        callbackRequests[req.body.options.rid] = function (m) {
          if (m.params.length) {
            if (m.params[0]) {
              m.params[0] = new Error(m.params[0])
            }
          }

          cb.apply(this, m.params)

          delete callbackRequests[req.body.options.rid]
        }

        var args = Array.prototype.slice.call(arguments)

        args.pop()
        process.send({action: 'callback', rid: req.body.options.rid, pid: process.pid, params: args.sort()})
      }

      require(req.body.options.execModulePath)(req.body.inputs, callback, function (err, val) {
        if (err) {
          return error(res, err)
        }

        res.end(JSON.stringify(val))
      })
    } catch (e) {
      error(res, e)
    }
  })
}
