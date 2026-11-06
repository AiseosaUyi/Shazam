function parseArgs(argv) {
  const out = { name: undefined, verbose: false, count: 1 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--name') out.name = argv[++i];
    else if (argv[i] === '--verbose') out.verbose = true;
    else if (argv[i] === '--count') out.count = Number(argv[++i]);
  }
  return out;
}
module.exports = { parseArgs };
