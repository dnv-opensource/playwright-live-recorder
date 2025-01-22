#!/usr/bin/env node

console.log('Running install script...');

const fs = require('fs');
const path = require('path');


function findProjectRoot() {
  let currentDir = process.cwd();
  while (!fs.existsSync(path.join(currentDir, 'package.json'))) {
    const parentDir = path.resolve(currentDir, '..');
    if (parentDir === currentDir) throw new Error('Could not find project root');
    currentDir = parentDir;
  }
  return currentDir;
}
  
const projectRoot = findProjectRoot();
process.chdir(projectRoot);

// Copy dist/example file to project root
const packageExamplesPath = path.resolve(path.dirname(require.resolve('@dnvgl/playwright-live-recorder')), 'example/');
for (const file of fs.readdirSync(packageExamplesPath)) {
  try {
    fs.copyFileSync(path.resolve(packageExamplesPath, file), path.resolve(projectRoot, file), fs.constants.COPYFILE_EXCL);
    console.log(`Copied example file ${file} to project root`);
  } catch (e) {
    if (e.code !== 'EEXIST') console.warn(`error copying file ${file} to ${projectRoot}`, e);
  }
}

// Create or modify /.vscode/settings.json
const vscodeDir = path.join(process.cwd(), '.vscode');
const settingsFile = path.join(vscodeDir, 'settings.json');

if (!fs.existsSync(vscodeDir)) fs.mkdirSync(vscodeDir);
const settings = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
if (!settings['playwright.env']) settings['playwright.env'] = { 'PWDEBUG': 'console' };
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
console.log(`Updated settings at: ${settingsFile}`);

// Create or modify ./tests/package.json
const testsDir = path.join(process.cwd(), 'tests');
const testsPackageFile = path.join(testsDir, 'package.json');

if (!fs.existsSync(testsDir)) fs.mkdirSync(testsDir);
const testsPackage = fs.existsSync(testsPackageFile) ? JSON.parse(fs.readFileSync(testsPackageFile, 'utf8')) : {};
testsPackage.type = 'module';
fs.writeFileSync(testsPackageFile, JSON.stringify(testsPackage, null, 2));
console.log(`Updated tests package at: ${testsPackageFile}`);