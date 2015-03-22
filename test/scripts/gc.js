module.exports = function(inputs, done) {
    process.nextTick(function() {
        global.gc();
        done(null, inputs);
    });
};
