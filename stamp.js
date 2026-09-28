// Adds a version tag (?v=<hash of the site's files>) to every script and stylesheet link in
// docs/*.html, so browsers never mix old cached files with new ones after an update.
// Run before committing: `npm run stamp`
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DOCS = path.join(__dirname, 'docs');
const assets = ['css', 'js', 'vendor'].flatMap(dir => fs.readdirSync(path.join(DOCS, dir)).map(f => path.join(dir, f))).sort();
const hash = crypto.createHash('sha1');
for (const f of assets) hash.update(f).update(fs.readFileSync(path.join(DOCS, f)));
const version = hash.digest('hex').slice(0, 8);

for (const page of fs.readdirSync(DOCS).filter(f => f.endsWith('.html'))) {
  const file = path.join(DOCS, page);
  const html = fs.readFileSync(file, 'utf8').replace(/((?:src|href)="(?:css|js|vendor)\/[^"?]+)(?:\?v=\w+)?"/g, `$1?v=${version}"`);
  fs.writeFileSync(file, html);
}
console.log(`Stamped pages with version ${version}`);
