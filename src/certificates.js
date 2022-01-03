const { mkdirSync, readFileSync, readlinkSync, watch } = require('fs');
const { once } = require('events');
const path = require('path');

exports.load = function (certPath) {
	const cert = {};
	const privPath = path.join(certPath, 'privkey.pem');
	const fullPath = path.join(certPath, 'fullchain.pem');
	try {
		mkdirSync(certPath, { recursive: true });
		cert.key = readFileSync(privPath);
		cert.cert = readFileSync(fullPath);
	} catch (err) {
		console.info("No certificate is available - will only start on http", err.toString());
	}

	if (cert.cert) {
		let toExit, realPath;
		try {
			realPath = readlinkSync(fullPath);
		} catch (ex) {
			realPath = fullPath;
		}
		watchCert(realPath).then(() => {
			if (toExit) return;
			const now = new Date();
			const tow = new Date(
				now.getFullYear(),
				now.getMonth(), now.getDate() + 1,
				3,
				Math.floor(Math.random() * 60)
			);
			console.info("Certificate changed - scheduling process exit at", tow);
			toExit = setTimeout(() => {
				process.exit(1);
			}, tow - now);
		});
	}
	return cert;
};

function watchCert(filePath) {
	return once(watch(filePath), 'change');
}
