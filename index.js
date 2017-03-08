var _ = require('underscore')
var S = require('string')

function updateProcessArgs () {
  // fix freeze during debugging
  process.execArgv = _.filter(process.execArgv, function (arg) {
    return !S(arg).startsWith('--debug')
  })
}

module.exports = function (_options) {
  var options = _options || {}

  options.timeout = options.timeout || 10000
  options.strategy = options.strategy || 'http-server'

  if (options.strategy === 'http-server') {
    updateProcessArgs()
    return new (require('./lib/manager-servers.js'))(options)
  }

  if (options.strategy === 'dedicated-process') {
    updateProcessArgs()
    return new (require('./lib/manager-processes.js'))(options)
  }

  if (options.strategy === 'in-process') {
    return new (require('./lib/in-process.js'))(options)
  }

  throw new Error('Unsupported scripts manager strategy: ' + options.strategy)
}

module.exports.ScriptManager = require('./lib/manager-servers.js')
module.exports.ScriptManagerOnHttpServers = module.exports.ScriptManager

module.exports.ScriptManagerOnProcesses = require('./lib/manager-processes.js')
