'use strict';
const path = require('path');
const root = process.env.LIBWEBP_ROOT || '';
if (!root) { process.stderr.write('LIBWEBP_ROOT is not set\n'); process.exit(1); }
process.stdout.write(path.join(root, 'include').replace(/\\/g, '/'));
