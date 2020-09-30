/* eslint-disable no-console */
// always resolve paths relative to app.js directory
process.chdir(__dirname);

const express = require('express');
const ini = require('./lib/express-ini');
const format = require('util').format;
const nopt = require("nopt");
const URL = require('url');
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

const parsed = nopt({
	"server" : Number,
	"node": Number
});
config.server = parsed.server || 0;
config.node = parsed.node || 0;

config.servers = Object.keys(config.servers).map(function(val) {
	const list = val.split(' ');
	const hostname = list.shift();
	const nodes = list.map(function(item) {
		var itemUrl = URL.parse(item);
		return URL.parse(URL.format({
			hostname: hostname,
			port: parseInt(itemUrl.path),
			protocol: itemUrl.protocol || 'http:'
		}));
	});
	return nodes;
});

config.site = config.servers[config.server][config.node];
config.site.port = config.site.port || 80;
config.listen = config.listen || config.site.port;

const server = config.site.protocol == "https:" ?
	require('https').createServer({
		key:readfile(format('private/%s/privkey.pem', config.site.hostname)),
		cert:readfile(format('private/%s/fullchain.pem', config.site.hostname))
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

require('./lib/express.js')(app, server);

process.title = format("ws-%s-%d-%d", app.settings.env, config.server, config.node);
process.on('uncaughtException', function(err) {
	console.log(err.stack || err.message || err);
});

server.listen(config.listen);

console.log("%s\n%s", process.title, app.settings.site.href);
