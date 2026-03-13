const fs = require('fs');

const glob = (dir) => {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    file = dir + '/' + file;
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) results = results.concat(glob(file));
    else if(file.endsWith('.wxml')) results.push(file);
  });
  return results;
};
const files = glob('./pages');
files.forEach(f => {
  let content = fs.readFileSync(f, 'utf8');
  if(!content.includes('<wxs src=')){
    content = '<wxs src="../../utils/fmt.wxs" module="fmt" />\n' + content;
  }
  content = content.replace(/\{\{\s*([a-zA-Z0-9_\$.]+)\.toFixed\(([0-9]+)\)\s*\}\}/g, '{{fmt.toFixed($1, $2)}}');
  fs.writeFileSync(f, content);
});
console.log('Done repairing WXML');