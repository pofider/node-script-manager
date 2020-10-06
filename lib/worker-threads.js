// eslint-disable-next-line
const domain = require('domain')
const uuid = require('uuid').v4
const convertUint8ArrayProperties = require('./convertUint8ArrayProperties')

const callbackRequests = {}

function callback (managerPort, rid, ...args) {
  const cid = uuid()

  callbackRequests[rid] = callbackRequests[rid] || {}
  callbackRequests[rid].cbs = callbackRequests[rid].cbs || {}

  if (!callbackRequests[rid].responseHandler) {
    callbackRequests[rid].responseHandler = (resPayload) => {
      if (resPayload.params.length && resPayload.params[0]) {
        resPayload.params[0] = new Error(resPayload.params[0])
      }
      const cb = callbackRequests[rid].cbs[resPayload.cid]

      delete callbackRequests[rid].cbs[resPayload.cid]

      // eslint-disable-next-line standard/no-callback-literal
      cb(...resPayload.params)

      if (Object.keys(callbackRequests[rid].cbs).length === 0) {
        delete callbackRequests[rid]
      }
    }
  }

  callbackRequests[rid].cbs[cid] = args[args.length - 1]

  args.pop()

  // NOTE: no need to handle a possible error when sending here because it will be cached as
  // part of runModule error handler
  managerPort.postMessage({
    rid,
    cid,
    action: 'callback',
    data: args.sort()
  })
}

module.exports = async function workerThreadExecute ({ waitForTaskRelease, managerPort }) {
  const execution = {}

  execution.promise = new Promise((resolve, reject) => {
    execution.resolve = resolve
    execution.reject = reject
  })

  managerPort.on('message', (payload) => {
    const { action } = payload

    switch (action) {
      case 'execute': {
        const { rid, data } = payload
        const { inputs, options } = data

        try {
          convertUint8ArrayProperties(inputs)
        } catch (e) {
          return managerPort.postMessage({
            rid,
            action: 'execute-response',
            data: createErrorResponse(e)
          })
        }

        const runPromise = runModule({
          execModulePath: options.execModulePath,
          rid,
          inputs,
          callback: callback.bind(undefined, managerPort, rid)
        })

        runPromise.then((result) => {
          try {
            managerPort.postMessage({
              rid,
              action: 'execute-response',
              data: result
            })
          } catch (e) {
            // usually error about some value could not be cloned,
            // in this case we response with the error
            managerPort.postMessage({
              rid,
              action: 'execute-response',
              data: createErrorResponse(e)
            })
          }

          if (!waitForTaskRelease) {
            managerPort.close()
            execution.resolve()
          }
        })

        break
      }

      case 'callback-response': {
        // we will receive here the response of callback execution
        const { rid, cid, data } = payload

        let params

        try {
          convertUint8ArrayProperties(data)
          params = data
        } catch (e) {
          params = [e.message]
        }

        callbackRequests[rid].responseHandler({
          cid,
          params
        })
        break
      }

      case 'release': {
        if (!waitForTaskRelease) {
          return
        }

        managerPort.close()
        execution.resolve()
        break
      }
    }
  })

  managerPort.postMessage({
    action: 'ready'
  })

  return execution.promise
}

async function runModule ({ execModulePath, rid, inputs, callback }) {
  return new Promise((resolve) => {
    // NOTE: we're using domains here intentionally,
    // we have tried to avoid its usage but unfortunately there is no other way to
    // ensure that we are handling all kind of errors that can occur in an external script,
    // but everything is ok because node.js will only remove domains when they found an alternative
    // and when that time comes, we just need to migrate to that alternative.
    const d = domain.create()

    d.on('error', (err) => {
      resolve(createErrorResponse(err))
    })

    d.run(() => {
      try {
        require(execModulePath)(inputs, callback, (err, result) => {
          let response

          if (err) {
            response = createErrorResponse(err)
          } else {
            response = {
              data: result
            }
          }

          resolve(response)
        })
      } catch (e) {
        resolve(createErrorResponse(e))
      }
    })
  })
}

function createErrorResponse (err) {
  const response = {
    error: {
      message: err.message,
      stack: err.stack
    }
  }

  return response
}
