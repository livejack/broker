var ini = require('ini');
var readfile = require('fs').readFileSync;

module.exports = function(app, file) {
	if (!file) file = './config.ini';
	try {
		var config = ini.parse(readfile(file, 'utf-8'));
		config = config[app.settings.env];
		for (var i in config) app.settings[i] = config[i];
	} catch (ex) {
		console.warn("No config file", file);
	}
	return app.settings;
};

