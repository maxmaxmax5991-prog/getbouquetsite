// Проверка перед выкладкой: синтаксис всех встроенных <script> в страницах.
// Ошибка в одном скрипте = пустая витрина, поэтому лучше упасть здесь, а не на сайте.
// Запуск: node server/ci/check-html.js index.html admin/index.html add/index.html
const fs = require("fs");
const vm = require("vm");
let bad = 0;
for (const file of process.argv.slice(2)) {
  const html = fs.readFileSync(file, "utf8");
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m, i = 0;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\bsrc\s*=/.test(attrs) || /type\s*=\s*["']?(application\/(ld\+)?json|text\/template)/i.test(attrs)) continue;
    i++;
    const line = html.slice(0, m.index).split("\n").length;
    const isModule = /type\s*=\s*["']?module/i.test(attrs);
    try {
      new vm.Script(m[2], { filename: `${file}:${line}` });
    } catch (e) {
      if (isModule && /import|export/.test(e.message)) continue;
      bad++;
      console.error(`ОШИБКА ${file}, скрипт со строки ${line}: ${e.message}`);
    }
  }
  console.log(`${file}: скриптов проверено ${i}`);
}
process.exit(bad ? 1 : 0);
