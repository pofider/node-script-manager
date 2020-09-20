const path = require('path')
const uuid = require('uuid').v4
const { Worker } = require('worker_threads')

const ScriptsManager = module.exports = function (options) {
  this.options = options
  this.options.timeout = this.options.timeout || 10000

  this._runningRequests = []

  process.once('exit', () => {
    console.log('exit process...')
    this.kill()
  })
}

ScriptsManager.prototype.start = function (cb) {
  this.worker = new Worker(path.join(__dirname, 'worker-threads.js'))

  this.worker.on('message', (payload) => {
    if (payload.action === 'execute-response') {
      const { rid } = payload
      const reqOptions = this._runningRequests.find((r) => r.rid === rid)

      if (!reqOptions || reqOptions.isDone) {
        return
      }

      reqOptions.isDone = true

      this._runningRequests = this._runningRequests.filter(r => r.rid !== rid)

      if (payload.error) {
        const e = new Error()
        e.message = payload.error.message
        e.stack = payload.error.stack
        e.weak = true

        return reqOptions.cb(e)
      }

      reqOptions.cb(null, payload.data)
    } else if (payload.action === 'callback') {
      const { rid, cid } = payload
      const reqOptions = this._runningRequests.find((r) => r.rid === rid)

      if (!reqOptions || reqOptions.isDone) {
        return
      }

      payload.data.push((...args) => {
        if (reqOptions.isDone) {
          return
        }

        if (args.length && args[0]) {
          args[0] = args[0].message
        }

        this.worker.postMessage({
          action: 'callback-response',
          rid,
          cid,
          data: args
        })
      })

      reqOptions.callback.apply(this, payload.data)
    }
  })

  this.worker.on('online', () => {
    console.log('worker is online')
    this.isStarted = true
    cb()
  })

  this.worker.on('error', (wError) => {
    console.log('worker uncaught error:', wError)

    if (!this.isStarted) {
      return cb(wError)
    }

    console.log('restarting worker..')
    this.start(function () {

    })
  })

  this.worker.on('exit', (code) => {
    if (code !== 0) {
      console.log('worker exit with error code:', code)
    } else {
      console.log('worker exit')
    }

    if (!this.isStarted) {
      return cb(new Error(`worker ended with exit code: ${code}`))
    }

    console.log('restarting worker..')
    this.start(function () {

    })
  })
}

ScriptsManager.prototype.ensureStarted = function (cb) {
  if (this.isStarted) {
    return cb()
  }

  this.start(cb)
}

ScriptsManager.prototype.execute = function (inputs, options, cb) {
  console.log('========SCRIPT MANAGER EXECUTE=========')
  const rid = uuid()
  let callback

  if (options && options.callback) {
    callback = options.callback
    delete options.callback
  }

  const reqOptions = {
    rid,
    isDone: false,
    callback,
    cb
  }

  const body = {
    inputs,
    options
  }

  this._runningRequests.push(reqOptions)

  this.worker.postMessage({
    action: 'execute',
    rid,
    data: body
  })
}

ScriptsManager.prototype.kill = function () {
  if (this.worker) {
    this.isStarted = false

    this.worker.terminate().then(() => {}).catch((e) => {
      console.error('error killing worker:', e)
    })
  }
}
