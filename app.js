// always resolve paths relative to app.js directory
process.chdir(__dirname);

const express = require('express');
const ini = require('./src/express-ini');
const path = require('path');
const { readFileSync, mkdirSync } = require('fs');

// APP
const app = express();

const config = ini(app);

Object.entries(config.namespaces).forEach(([namespace, token]) => {
	config.namespaces[namespace] = { namespace, token };
});

const argv = (process.argv.length == 3 ? process.argv[2] : "0-0")
	.split('-')
	.map((x) => parseInt(x));
if (!argv.length == 2) throw new Error("node app.js <server>-<node>");

config.server = argv[0];
config.node = argv[1];

config.servers = config.servers.map((val) => {
	const list = val.split(' ');
	const hostname = list.shift();
	const nodes = list.map((item) => {
		const itemUrl = new URL(`http://${hostname}`);
		const parts = item.split(':');
		itemUrl.port = parseInt(parts.pop());
		if (parts.length > 0) itemUrl.protocol = parts[0];
		return itemUrl;
	});
	return nodes;
});

config.site = config.servers[config.server][config.node];

const cert = {};

try {
	const certPath = `${config.dirs.config}/${config.site.hostname}`;
	mkdirSync(certPath, { recursive: true });
	cert.key = readFileSync(`${certPath}/privkey.pem`);
	cert.cert = readFileSync(`${certPath}/fullchain.pem`);
} catch (err) {
	console.info("No certificate is available - will only start on http", err.toString());
}

const server = cert.cert && config.site.protocol == "https:" ?
	require('https').createServer(cert, app)
	:
	require('http').createServer(app);

app.get('/', (req, res, next) => {
	res.json({
		version: config.version,
		server: config.server,
		node: config.node
	});
});

const webroot = (config.certbot || {}).webroot;
if (webroot) {
	const acmepath = '/.well-known/acme-challenge';
	console.info("Listening for acme challenges:", webroot);
	app.use(
		acmepath,
		express.static(path.join(webroot, acmepath)),
		(req, res, next) => {
			res.sendStatus(404);
		}
	);
}

require('./src/express.js')(app, server);

process.title = `ws-${app.settings.env}-${config.server}-${config.node}`;
process.on('uncaughtException', (err) => {
	console.error(err.stack || err.message || err);
});

server.listen(config.site.port);

console.info("%s\n%s", process.title, config.site.href);
