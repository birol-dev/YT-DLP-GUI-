'use strict';

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '../..');

function collectJsFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) out.push(...collectJsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

function uniqueExisting(files) {
  const seen = new Set();
  const out = [];
  for (const f of files) {
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    out.push(f);
  }
  return out;
}

function readConcat(files) {
  return uniqueExisting(files).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

function getMainSource() {
  return readConcat([
    path.join(rootDir, 'main.js'),
    ...collectJsFiles(path.join(rootDir, 'src/main'))
  ]);
}

function getRendererSource() {
  return readConcat([
    path.join(rootDir, 'renderer.js'),
    path.join(rootDir, 'renderer/index.js'),
    ...collectJsFiles(path.join(rootDir, 'renderer')),
    ...collectJsFiles(path.join(rootDir, 'assets'))
  ]);
}

function getAppJsFiles() {
  return uniqueExisting([
    path.join(rootDir, 'main.js'),
    path.join(rootDir, 'preload.js'),
    path.join(rootDir, 'renderer.js'),
    ...collectJsFiles(path.join(rootDir, 'src/main')),
    ...collectJsFiles(path.join(rootDir, 'renderer')),
    ...collectJsFiles(path.join(rootDir, 'assets'))
  ]);
}

module.exports = {
  rootDir,
  collectJsFiles,
  getMainSource,
  getRendererSource,
  getAppJsFiles
};
