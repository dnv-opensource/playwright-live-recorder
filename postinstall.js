//copy example files into root folder if they don't already exist
const fs = require('node:fs');
const dest = process.env.INIT_CWD;
fs.readdirSync('example').forEach(file => {
    try { 
        fs.copyFileSync('example/' + file, dest + '/' + file, fs.constants.COPYFILE_EXCL); 
    } catch(e) {
        if (e.code !== 'EEXIST') throw e; //ignore "errors" if file exists, we don't want to overwrite, and we don't need to show an error to the user
    }
});