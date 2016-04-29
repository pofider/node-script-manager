var childProcess = require("child_process");
var path = require("path");
var _ = require("underscore");
var S = require("string");

var ScriptsManager = module.exports = function (options) {
    this.options = options;
    this.options.timeout = this.options.timeout || 10000;
};


ScriptsManager.prototype.start = function (cb) {
    cb();
};

ScriptsManager.prototype.ensureStarted = function (cb) {
    cb();
};

ScriptsManager.prototype.execute = function (inputs, options, cb) {
    var self = this;
    var isDone = false;

    var worker = childProcess.fork(path.join(__dirname, "worker-processes.js"));

    worker.on('message', function (m) {


        if (m.error) {
            isDone = true;
            var error = new Error(m.error);
            error.stack = m.errorStack;
            return cb(error);
        }

        if (m.action === "process-response") {
            isDone = true;
            return cb(null, m.value);
        }

        if (m.action === "callback") {
            m.params.push(function(){
                var args = Array.prototype.slice.call(arguments);
                if (args.length && args[0]) {
                    args[0] = args[0].message;
                }
                worker.send({
                    action: "callback-response",
                    params: args
                })
            });
            options.callback.apply(self, m.params);
        }
    });

    worker.send({
        inputs: inputs,
        options: options
    });

    setTimeout(function () {
        if (isDone)
            return;

        worker.kill();

        cb(new Error("Timeout error during executing script"));
    },  options.timeout || this.options.timeout).unref();
};

ScriptsManager.prototype.kill = function () {
};


