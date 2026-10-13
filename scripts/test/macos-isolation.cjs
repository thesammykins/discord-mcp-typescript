// Test invocation only: mirror Linux fixture roots on macOS, including child CLIs.
// Never use this preload to run the production server.
const os = require('node:os');
const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const originalHome = os.homedir;
const originalTmp = os.tmpdir;
os.homedir = () => process.env.XDG_CONFIG_HOME || process.env.APPDATA || originalHome();
os.tmpdir = () => fs.realpathSync(originalTmp());
syncBuiltinESMExports();
