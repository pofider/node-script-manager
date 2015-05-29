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


process.on('message', function (m) {
    if (m.action === "callback-response") {
        if (m.params.length) {
            if (m.params[0]) {
                m.params[0] = new Error(m.params[0]);
            }
        }
        cb.apply(this, m.params);
    }

    require(m.options.execModulePath)(m.inputs, callback, function (err, val) {
        if (err) {
            process.send({
                error: err.message,
                errorStack: err.stack
            });
        } else {
            process.send({
                action: "process-response",
                value: val
            });
        }

        process.exit();
    });
});