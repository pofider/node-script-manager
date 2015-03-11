#script-manager
[![Build Status](https://travis-ci.org/pofider/node-script-manager.png?branch=master)](https://travis-ci.org/pofider/node-script-manager)

**node.js manager for running foreign and potentially dangerous scripts in the cluster**

You can use node.js vm module for running a custom javascript code, but when the code is bad it can quickly get your node.js process into an endless loop. For this reason it is better to run users's custom code in a separate node process which you can recycle when the script reaches timeout. This can be achieved using node child_process module, but a simple implementation has limitations in performance and scale because running each script in a new node child process can quickly spawn whole system with node processes. This package solve problem of running user's custom javascript code in a load balanced cluster of node processes which are reused over the requests and recycled when needed.

```js
var scriptManager = require("script-manager")({ numberOfWorkers: 2 });

scriptManager.ensureStarted(function(err) {

	//send user's script including some other specific options into
	//wrapper specified by execModulePath
	scriptManager.execute({	
		script: "return 'Jan';"
	}, { 
		execModulePath: path.join(__dirname, "script.js"),
	    timeout: 10
	}, function(err, res) {
		console.log(res);
	});
	
});
```

```js
//script.js
//wrapper usually does some fancy thing and then runs the custom script using node.js vm module
module.exports = function(inputs, done) {
	var result = require('vm').runInNewContext(inputs.script, {
		require: function() { throw new Error("Not supported"); }
	});
	done(result);
});
```



##License
See [license](https://github.com/pofider/node-script-manager/blob/master/LICENSE)
