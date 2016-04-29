process.on('uncaughtException', function (err) {
    process.send({
        error: err.message,
        errorStack: err.stack
    });

    process.exit();
});

var cb;

function callback() {
    cb = arguments[arguments.length - 1];
    var args = Array.prototype.slice.call(arguments);
    args.pop();
    process.send({action: "callback", pid: process.pid, params: args.sort()});
}


function sendAndExit(m) {
    var version = parseInt(process.version.split('.')[0].substring(1))
    if (version < 4) {
        process.send(m)
        setTimeout(function() {
            process.exit()
        }, 5000)
    } else {
        process.send(m, function() {
            process.exit()
        })
    }
}


process.on('message', function (m) {
    if (m.action === "callback-response") {
        if (m.params.length) {
            if (m.params[0]) {
                m.params[0] = new Error(m.params[0]);
            }
        }
        return cb.apply(this, m.params);
    }

    require(m.options.execModulePath)(m.inputs, callback, function (err, val) {
        if (err) {
            sendAndExit({
                error: err.message,
                errorStack: err.stack
            });
        } else {
            sendAndExit({
                action: "process-response",
                value: val
            });
        }
    });
});