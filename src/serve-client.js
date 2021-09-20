const zlib = require('zlib');
const constants = require('constants');
const accepts = require('accepts');
const readSync = require('fs').readFileSync;

const clientVersion = require('socket.io-client/package.json').version;
const clientSource = readSync(
	require.resolve('socket.io-client/dist/socket.io.js').replace(/\.js$/, '.min.js')
).toString();

const zopts = { level: constants.Z_BEST_COMPRESSION };
const clientSourceGz = zlib.gzipSync(clientSource, zopts);
const clientSourceDfl = zlib.deflateSync(clientSource, zopts);

// every six hours, set expiration 12 hours later
let expires;
expiration();

function expiration() {
	expires = new Date(Date.now() + 1000 * 3600 * 12).toUTCString();
}

setInterval(expiration, 1000 * 3600 * 6);

module.exports = function(req, res) {
	const etag = req.headers['if-none-match'];
	if (etag) {
		if (clientVersion == etag) {
			res.writeHead(304);
			res.end();
			return;
		}
	}
	const method = accepts(req).encoding('gzip', 'deflate');
	let data;
	if (method == 'gzip') {
		res.setHeader('Content-Encoding', 'gzip');
		data = clientSourceGz;
	} else if (method == 'deflate') {
		res.setHeader('Content-Encoding', 'deflate');
		data = clientSourceDfl;
	} else {
		data = clientSource;
	}

	res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
	res.setHeader('ETag', clientVersion);
	res.setHeader('Expires', expires);
	res.writeHead(200);
	res.end(data);
};

