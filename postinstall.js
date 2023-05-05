'use strict'
var gentlyCopy = require('gently-copy')
var filesToCopy = ['example/*'];
gentlyCopy(filesToCopy, process.env.INIT_CWD);