// always resolve paths relative to app.js directory
process.chdir(__dirname);

const express = require('express');
const ini = require('./src/express-ini');
const format = require('util').format;
const readfile = require('fs').readFileSync;
const mkdirp = require('mkdirp');

// APP
const app = express();

const config = ini(app);

Object.keys(config.namespaces).forEach(function(ns) {
	const obj = {
		namespace: ns,
		token: config.namespaces[ns]
	};
	try {
		obj.publicKey = readfile('private/' + ns + '.pem');
	} catch(ex) {
		console.warn("No public key for", ns);
	}
	config.namespaces[ns] = obj;
});

const argv = (process.argv.length == 3 ? process.argv[2] : "0-0")
	.split('-')
	.map((x) => parseInt(x));
if (!argv.length == 2) throw new Error("node app.js <server>-<node>");

config.server = argv[0];
config.node = argv[1];

config.servers = config.servers.map(function(val) {
	const list = val.split(' ');
	const hostname = list.shift();
	const nodes = list.map(function (item) {
		const itemUrl = new URL(`http://${hostname}`);
		const parts = item.split(':');
		itemUrl.port = parseInt(parts.pop());
		if (parts.length > 0) itemUrl.protocol = parts[0];
		return itemUrl;
	});
	return nodes;
});

config.site = config.servers[config.server][config.node];
config.site.port = config.site.port || 80;
config.listen = config.listen || config.site.port;

const server = config.site.protocol == "https:" ?
	require('https').createServer({
		key:readfile(format(`${config.dirs.config}/%s/privkey.pem`, config.site.hostname)),
		cert:readfile(format(`${config.dirs.config}/%s/fullchain.pem`, config.site.hostname))
	}, app)
	:
	require('http').createServer(app);

const acmeRoot = '/.well-known/acme-challenge';
mkdirp.sync(__dirname + acmeRoot);
app.use(
	acmeRoot,
	express.static(__dirname + acmeRoot),
	function(req, res, next) {
		console.info("File not found", req.path);
		res.sendStatus(404);
	}
);

require('./src/express.js')(app, server);

process.title = format("ws-%s-%d-%d", app.settings.env, config.server, config.node);
process.on('uncaughtException', function(err) {
	console.log(err.stack || err.message || err);
});

server.listen(config.listen);

console.log("%s\n%s", process.title, app.settings.site.href);
