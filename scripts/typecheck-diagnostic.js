const { spawnSync } = require('child_process');
const fs = require('fs');

const result = spawnSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['tsc', '-p', 'tsconfig.v2.json', '--noEmit', '--pretty', 'false'],
  {
    encoding: 'utf8',
  }
);

const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  .trim()
  .split('\n')
  .filter(Boolean)
  .slice(0, 120);

fs.writeFileSync(
  'typecheck-diagnostic.json',
  JSON.stringify(
    {
      exitCode: result.status,
      output,
    },
    null,
    2
  )
);

console.log('Phase 1H.3 typecheck diagnostic generated');
