const { parentPort } = require('worker_threads')
const uuid = require('uuid').v4

const callbackRequests = {}

function callback (rid, ...args) {
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

  parentPort.postMessage({
    action: 'callback',
    rid,
    cid,
    data: args.sort()
  })
}

parentPort.on('message', (payload) => {
  if (payload.action === 'execute') {
    const { rid } = payload
    const { inputs, options } = payload.data

    try {
      require(options.execModulePath)(inputs, callback.bind(undefined, rid), (err, result) => {
        const response = {
          action: 'execute-response',
          rid
        }

        if (err) {
          response.error = {
            message: err.message,
            stack: err.stack
          }
        } else {
          response.data = result
        }

        parentPort.postMessage(response)
      })
    } catch (e) {
      const response = {
        action: 'execute-response',
        rid,
        error: {
          message: e.message,
          stack: e.stack
        }
      }

      parentPort.postMessage(response)
    }
  } else if (payload.action === 'callback-response') {
    const { rid, cid } = payload

    callbackRequests[rid].responseHandler({
      cid,
      params: payload.data
    })
  }
})
