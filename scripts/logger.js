const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
  magenta: "\x1b[35m",
};

function log(color, prefix, msg) {
  const time = new Date().toLocaleTimeString();
  console.log(`${c.gray}[${time}]${c.reset} ${color}${c.bold}${prefix}${c.reset} ${msg}`);
}

const info    = (msg) => log(c.cyan,    "●", msg);
const success = (msg) => log(c.green,   "✔", msg);
const warn    = (msg) => log(c.yellow,  "⚠", msg);
const error   = (msg) => log(c.red,     "✖", msg);
const section = (msg) => console.log(`\n${c.magenta}${c.bold}━━━ ${msg} ━━━${c.reset}\n`);

module.exports = { c, info, success, warn, error, section };
