/* eslint-disable no-console */
const bodyParser = require('body-parser');
const backlog = require("socket.io-backlog");
const IoServer = require('socket.io');
const graphite = require('graphite');
const writer = require('./writer');

module.exports = function(app, server) {
	const config = app.settings;
	if (!config.servers) config.servers = [];

	IoServer.prototype.serve = require('./serve-client.js');
	const io = IoServer(server, {
		wsEngine: 'eiows',
		serveClient: true,
		clientTracking: false,
		perMessageDeflate: false
	});
	io.adapter(backlog({ cacheSize: 300, length: 1000 }));

	const spaces = {};

	for (let namespace in config.namespaces) {
		const nsp = io.of(namespace);
		const cns = config.namespaces[namespace];
		cns.errors = 0;
		spaces[namespace] = nsp;
		if (config.node > 0) {
			writer.slave(nsp, namespace, config);
		} else {
			writer.master(nsp, namespace, config);
		}
	}

	if (config.graphite) {
		if (config.graphite.url && config.graphite.bucket && config.graphite.namespaces) {
			const client = graphite.createClient(config.graphite.url);
			let interval = config.graphite.interval || 30000;
			if (interval < 10000) interval = 10000;
			setInterval(writeStats.bind(null, client, config), interval);
			console.info("graphite sending to", config.graphite.url, "every", interval, "ms");
		} else {
			console.error("graphite expects url, bucket, namespaces");
		}
	} else {
		console.info("no graphite config");
	}

	app.use(bodyParser.json());
	app.use(bodyParser.urlencoded({extended:true}));
	app.use(require('morgan')(':method :status :response-time ms :url - :res[content-length]'));

	app.post('/:namespace', writer.post(spaces));

	app.use(function(err, req, res, next) {
		if (err) console.error(err.stack || err.message || err);
		next();
	});

	function writeStats(client, config) {
		const metrics = {};
		Object.keys(config.graphite.namespaces).forEach(function (namespace) {
			if (config.namespaces[namespace] == null) {
				console.warn("Unknown namespace in graphite.namespaces:", namespace);
				return;
			}
			const nsp = io.of(namespace);
			const connected = nsp.connected;
			const metric = [
				config.graphite.bucket,
				namespace,
				config.server,
				config.node
			].join('.');
			let pollings = 0;
			let websockets = 0;
			for (let k in connected) {
				if (connected[k].conn.transport.name == "polling") pollings++;
				else websockets++;
			}
			metrics[metric + '.pollings'] = pollings;
			metrics[metric + '.websockets'] = websockets;
			metrics[metric + '.errors'] = config.namespaces[namespace].errors || 0;
		});
		client.write(metrics, function(err) {
			if (err) return console.error("Error writing metrics", err);
		});
	}
};

