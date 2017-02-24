require('should')
var path = require('path')
var ScriptsManager = require('../lib/manager-servers.js')
var ScriptsManagerWithProcesses = require('../lib/manager-processes.js')
var ScriptManagerInProcess = require('../lib/in-process.js')

describe('scripts manager', function () {
  describe('servers', function () {
    var scriptsManager = new ScriptsManager({numberOfWorkers: 2})

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)
    commonForSafeExecution(scriptsManager)

    it('should be able to set up on custom port', function (done) {
      var scriptsManager2 = new ScriptsManager({ numberOfWorkers: 1, portLeftBoundary: 10000, portRightBoundary: 11000 })

      scriptsManager2.start(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager2.execute({ foo: 'foo' }, {execModulePath: path.join(__dirname, 'scripts', 'script.js')}, function (err, res) {
          if (err) {
            return done(err)
          }

          scriptsManager2.options.port.should.be.within(10000, 11000)
          res.foo.should.be.eql('foo')
          done()
        })
      })
    })

    it('should be able to process high data volumes', function (done) {
      this.timeout(7000)

      var data = { foo: 'foo', people: [] }

      for (var i = 0; i < 2000000; i++) {
        data.people.push(i)
      }

      scriptsManager.execute(data, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql('foo')
        done()
      })
    })
  })

  describe('servers with custom settings', function () {
    it('should fail when input exceeds the inputRequestLimit', function (done) {
      var scriptsManager = new ScriptsManager({numberOfWorkers: 2, inputRequestLimit: 5})

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute('foooooo', {execModulePath: path.join(__dirname, 'scripts', 'script.js')}, function (err, res) {
          scriptsManager.kill()

          if (err) {
            return done()
          }

          done(new Error('It should have dailed'))
        })
      })
    })

    it('should not fail when input is shorter the inputRequestLimit', function (done) {
      var scriptsManager = new ScriptsManager({numberOfWorkers: 2, inputRequestLimit: 500})

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute('foooooo', {execModulePath: path.join(__dirname, 'scripts', 'script.js')}, function (err, res) {
          scriptsManager.kill()
          if (err) {
            return done(err)
          }

          done()
        })
      })
    })

    it('should be able to expose gc through args to dedicated process', function (done) {
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, strategy: 'dedicated-process', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'gc.js') }, function (err, res) {
          if (err) {
            return done(err)
          }

          res.foo.should.be.eql('foo')
          done()
        })
      })
    })

    it('should be able to expose gc through args to http server', function (done) {
      var scriptsManager = new ScriptsManager({ numberOfWorkers: 2, strategy: 'http-server', inputRequestLimit: 500, forkOptions: { execArgv: ['--expose-gc'] } })

      scriptsManager.ensureStarted(function (err) {
        if (err) {
          return done(err)
        }

        scriptsManager.execute({ foo: 'foo' }, {execModulePath: path.join(__dirname, 'scripts', 'gc.js')}, function (err, res) {
          if (err) {
            return done(err)
          }

          res.foo.should.be.eql('foo')
          done()
        })
      })
    })
  })

  describe('processes', function () {
    var scriptsManager = new ScriptsManagerWithProcesses({ numberOfWorkers: 2 })

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)
    commonForSafeExecution(scriptsManager)
  })

  describe('in process', function () {
    var scriptsManager = new ScriptManagerInProcess({})

    beforeEach(function (done) {
      scriptsManager.ensureStarted(done)
    })

    afterEach(function () {
      scriptsManager.kill()
    })

    common(scriptsManager)

    it('should handle timeouts', function (done) {
      var timeouted = false

      scriptsManager.execute({ foo: 'foo' },
        {
          execModulePath: path.join(__dirname, 'scripts', 'timeout.js'),
          timeout: 10
        }, function (err) {
          if (err) {
            timeouted = true
            done()
          }
        })

      setTimeout(function () {
        if (!timeouted) {
          done(new Error('It should timeout'))
        }
      }, 500)
    })
  })

  function commonForSafeExecution (scriptsManager) {
    it('should handle timeouts', function (done) {
      var timeouted = false

      scriptsManager.execute({ foo: 'foo' },
        {
          execModulePath: path.join(__dirname, 'scripts', 'timeout.js'),
          timeout: 10
        }, function () {
          timeouted = true
          done()
        })

      setTimeout(function () {
        if (!timeouted) {
          done(new Error('It should timeout'))
        }
      }, 500)
    })

    it('should handle unexpected error', function (done) {
      scriptsManager.execute({ foo: 'foo' }, {execModulePath: path.join(__dirname, 'scripts', 'unexpectedError.js')}, function (err, res) {
        if (err) {
          return done()
        }

        done(new Error('There should be an error'))
      })
    })
  }

  function common (scriptsManager) {
    it('should be able to execute simple script', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'script.js') }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql('foo')
        done()
      })
    })

    it('should handle script error', function (done) {
      scriptsManager.execute({ foo: 'foo' }, { execModulePath: path.join(__dirname, 'scripts', 'error.js') }, function (err, res) {
        if (!err) {
          return done(new Error('It should have failed.'))
        }

        err.stack.should.containEql('error.js')
        done()
      })
    })

    it('should be able to callback to the caller', function (done) {
      function callback (str, cb) {
        cb(null, str + 'aaa')
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.test.should.be.eql('testaaa')

        done()
      })
    })

    it('should be able to callback error to the caller', function (done) {
      function callback (str, cb) {
        cb(null, str + 'aaa')
      }

      scriptsManager.execute({}, {
        execModulePath: path.join(__dirname, 'scripts', 'callbackError.js'),
        callback: callback
      }, function (err, res) {
        if (err) {
          return done()
        }

        done(new Error('It should have failed'))
      })
    })

    it('should be able to process parallel requests', function (done) {
      function callback (str, cb) {
        setTimeout(function () {
          cb(null, str + 'aaa')
        }, 10)
      }

      var doneCounter = []

      for (var i = 0; i < 20; i++) {
        scriptsManager.execute({}, {
          execModulePath: path.join(__dirname, 'scripts', 'callback.js'),
          callback: callback
        }, function (err, res) {
          if (err) {
            return done(err)
          }

          res.test.should.be.eql('testaaa')
          doneCounter++

          if (doneCounter === 20) {
            done()
          }
        })
      }
    })

    it('should be able to execute script with giant input data', function (done) {
      this.timeout(20000)
      var foo = 'xxx'

      for (var i = 0; i < 1000000; i++) {
        foo += 'yyyyyyyyyyyyy'
      }

      scriptsManager.execute({
        foo: foo
      }, {
        execModulePath: path.join(__dirname, 'scripts', 'script.js'),
        timeout: 20000
      }, function (err, res) {
        if (err) {
          return done(err)
        }

        res.foo.should.be.eql(foo)
        done()
      })
    })
  }
})
