/**
 * 构建后检查产物体积，超出预算即失败，防止管理端越做越重。
 *
 * 按 gzip 后的大小计算，与浏览器实际下载量一致。管理端不拆包，assets 里的 JS / CSS 就是首屏全部代码。
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

/** 体积预算（字节，gzip 后） */
const BUDGET = { js: 60 * 1024, css: 8 * 1024 };

/** 构建产物目录 */
const ASSETS_DIR = 'dist/assets';

const totals = { js: 0, css: 0 };
for (const name of readdirSync(ASSETS_DIR).sort()) {
  const kind = name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css' : null;
  if (kind === null) {
    continue;
  }
  const size = gzipSync(readFileSync(join(ASSETS_DIR, name)), { level: 9 }).length;
  totals[kind] += size;
  console.log(`  ${name.padEnd(32)} ${(size / 1024).toFixed(1).padStart(6)} KB gzip`);
}

let isOverBudget = false;
for (const kind of /** @type {const} */ (['js', 'css'])) {
  const line = `${kind.toUpperCase()} 合计 ${(totals[kind] / 1024).toFixed(1)} KB / 预算 ${BUDGET[kind] / 1024} KB`;
  if (totals[kind] > BUDGET[kind]) {
    isOverBudget = true;
    console.error(`✗ ${line}`);
  } else {
    console.log(`✓ ${line}`);
  }
}

if (isOverBudget) {
  console.error('产物超出体积预算：先确认新增依赖是否必要，确需放宽时修改 scripts/check-size.mjs 并说明原因。');
  process.exit(1);
}
