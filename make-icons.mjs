import { createRequire } from 'module';
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright/index.js')); }
import fs from 'fs';

// 빨강 배경 + 흰 꽃(5 꽃잎) + 검정 중심. scale로 꽃 크기 조절(마스커블용 여백).
function flowerSVG(size, flowerScale = 1, bg = '#dc2626') {
  const petals = [0, 72, 144, 216, 288].map(
    (a) => `<ellipse cx="0" cy="-92" rx="48" ry="84" transform="rotate(${a})"/>`
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="${bg}"/>
    <g transform="translate(256,256) scale(${flowerScale})">
      <g fill="#ffffff" opacity="0.97">${petals}</g>
      <circle r="52" fill="#000000"/>
      <circle r="52" fill="none" stroke="#333333" stroke-width="4"/>
    </g>
  </svg>`;
}

const browser = await chromium.launch({ headless: true });

async function render(svg, size, outPath) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<!DOCTYPE html><html><body style="margin:0;padding:0;">${svg}</body></html>`,
    { waitUntil: 'load' }
  );
  await page.locator('svg').screenshot({ path: outPath, omitBackground: false });
  await page.close();
  const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
  console.log(`✅ ${outPath} (${size}x${size}, ${kb} KB)`);
}

// any 용 (꽉 찬 디자인)
await render(flowerSVG(192, 1.0), 192, 'icon-192.png');
await render(flowerSVG(512, 1.0), 512, 'icon-512.png');
// maskable 용 (안전 영역 — 꽃을 약 70%로 축소해 잘림 방지)
await render(flowerSVG(512, 0.66), 512, 'icon-maskable-512.png');
// Apple 터치 아이콘
await render(flowerSVG(180, 1.0), 180, 'apple-touch-icon.png');

// 앱 스크린샷 생성 (540x720 헤드리스 모드)
const screenshotPage = await browser.newPage({
  viewport: { width: 540, height: 720 },
  deviceScaleFactor: 1
});
await screenshotPage.goto('file://' + process.cwd() + '/index.html', { waitUntil: 'networkidle' });
await screenshotPage.waitForTimeout(500);
await screenshotPage.screenshot({ path: 'screenshot-narrow.png', fullPage: false });
await screenshotPage.close();
const screenshotKb = (fs.statSync('screenshot-narrow.png').size / 1024).toFixed(1);
console.log(`✅ screenshot-narrow.png (540x720, ${screenshotKb} KB)`);

await browser.close();
console.log('\n아이콘 및 스크린샷 생성 완료!');
