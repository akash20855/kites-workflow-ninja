// Produces kites-and-threads-workflow.standalone.html: one file that works fully offline,
// with no other file and no network needed. Run with: node build.js
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const read = (name) => fs.readFileSync(path.join(dir, name), 'utf8');

if (!fs.existsSync(path.join(dir, 'logo-white.png'))) throw new Error('logo-white.png is missing');

function inlineScript(source, file) {
  const tag = '<script src="' + file + '"></script>';
  if (!html.includes(tag)) throw new Error('Expected ' + tag + ' in index.html');
  return source.replace(tag, () => '<script>\n' + read(file) + '\n</script>');
}

let out = inlineScript(html, 'workflow.js');
out = inlineScript(out, 'invoice.js');
out = inlineScript(out, 'pwa.js');

// The standalone file is opened straight from disk, so it cannot be installed as an
// app. Drop the manifest and icon links rather than leave them pointing at nothing.
const logoTag = 'src="logo-white.png"';
if (!out.includes(logoTag)) throw new Error('Expected ' + logoTag + ' in index.html');
const logoUri = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'logo-white.png')).toString('base64');
out = out.replace(logoTag, () => 'src="' + logoUri + '"');

// The document logo is referenced from a constant, because invoice.js builds the image
// tag at runtime. Swap the constant for a data URI as well.
const blackTarget = "const LOGO_HREF = 'logo-black.png';";
if (!out.includes(blackTarget)) throw new Error('Expected the LOGO_HREF line in index.html');
const blackUri = 'data:image/png;base64,' + fs.readFileSync(path.join(dir, 'logo-black.png')).toString('base64');
out = out.replace(blackTarget, () => "const LOGO_HREF = '" + blackUri + "';");

out = out.replace(/\n<link rel="manifest"[^>]*>/, '')
  .replace(/\n<link rel="apple-touch-icon"[^>]*>/, '')
  .replace(/\n<link rel="icon"[^>]*>/, '');

const target = path.join(dir, 'kites-and-threads-workflow.standalone.html');
fs.writeFileSync(target, out);
console.log('wrote ' + path.basename(target) + ' (' + Math.round(out.length / 1024) + ' KB)');
