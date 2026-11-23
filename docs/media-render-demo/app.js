'use strict';

/* 生成离线可用的占位图，避免依赖外网素材。 */
function placeholder(width, height, c1, c2, label) {
  const unit = Math.min(width, height);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    width +
    '" height="' +
    height +
    '" viewBox="0 0 ' +
    width +
    ' ' +
    height +
    '">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' +
    c1 +
    '"/><stop offset="1" stop-color="' +
    c2 +
    '"/></linearGradient></defs>' +
    '<rect width="100%" height="100%" fill="url(#g)"/>' +
    '<circle cx="' +
    width * 0.26 +
    '" cy="' +
    height * 0.3 +
    '" r="' +
    unit * 0.14 +
    '" fill="rgba(255,255,255,0.2)"/>' +
    '<path d="M0 ' +
    height +
    ' L' +
    width * 0.34 +
    ' ' +
    height * 0.56 +
    ' L' +
    width * 0.58 +
    ' ' +
    height * 0.78 +
    ' L' +
    width * 0.8 +
    ' ' +
    height * 0.5 +
    ' L' +
    width +
    ' ' +
    height * 0.8 +
    ' L' +
    width +
    ' ' +
    height +
    ' Z" fill="rgba(0,0,0,0.16)"/>' +
    (label
      ? '<text x="50%" y="52%" font-family="ui-monospace, monospace" font-size="' +
        Math.round(unit * 0.1) +
        '" fill="rgba(255,255,255,0.9)" text-anchor="middle" dominant-baseline="middle">' +
        label +
        '</text>'
      : '') +
    '</svg>';
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

document.querySelectorAll('img[data-ph]').forEach((img) => {
  img.src = placeholder(
    Number(img.dataset.phW || 400),
    Number(img.dataset.phH || 300),
    img.dataset.phC1 || '#8b9dff',
    img.dataset.phC2 || '#a06bff',
    img.dataset.phLabel || '',
  );
});

/* ── 标签页 ─────────────────────────────────────────────── */
const tabs = Array.from(document.querySelectorAll('.tab'));
const views = Array.from(document.querySelectorAll('.view'));

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((candidate) => {
      candidate.setAttribute('aria-selected', String(candidate === tab));
    });
    views.forEach((view) => {
      view.setAttribute('data-active', String(view.dataset.view === tab.dataset.tab));
    });
  });
});

/* ── 主题切换 ───────────────────────────────────────────── */
const themeButton = document.getElementById('theme-toggle');
themeButton.addEventListener('click', () => {
  const root = document.documentElement;
  const isLight = root.dataset.mode === 'light';
  root.dataset.mode = isLight ? 'dark' : 'light';
  themeButton.textContent = isLight ? '切换亮色' : '切换暗色';
});

/* ── 灯箱 ───────────────────────────────────────────────── */
const lightbox = document.getElementById('lb');
const lbImage = document.getElementById('lb-img');
const lbCaption = document.getElementById('lb-caption');
const lbCounter = document.getElementById('lb-counter');
const lbStrip = document.getElementById('lb-strip');
const lbZoomLabel = document.getElementById('lb-zoom-label');
const lbKbd = document.getElementById('lb-kbd');

let lightboxItems = [];
let lightboxIndex = 0;
let scale = 1;
let rotation = 0;

function isImmersiveView() {
  /* 方案 C 与融合方案共用增强版灯箱（缩略图条 + 键盘提示）。 */
  return ['c', 'd'].some((key) => {
    const target = document.querySelector('[data-view="' + key + '"]');
    return target !== null && target.dataset.active === 'true';
  });
}

function applyTransform() {
  lbImage.style.transform = 'scale(' + scale + ') rotate(' + rotation + 'deg)';
  lbZoomLabel.textContent = Math.round(scale * 100) + '%';
}

function renderStrip() {
  /* 缩略图条与键盘提示只属于方案 C 的增强灯箱。 */
  const immersive = isImmersiveView();
  lbStrip.style.display = immersive && lightboxItems.length > 1 ? 'flex' : 'none';
  lbKbd.style.display = immersive ? 'block' : 'none';
  lbStrip.innerHTML = '';
  if (!immersive) return;
  lightboxItems.forEach((item, i) => {
    const thumb = document.createElement('button');
    thumb.className = 'lb__thumb';
    thumb.setAttribute('aria-current', String(i === lightboxIndex));
    const thumbImage = document.createElement('img');
    thumbImage.src = item.src;
    thumbImage.alt = item.label;
    thumb.appendChild(thumbImage);
    thumb.addEventListener('click', (event) => {
      event.stopPropagation();
      showImage(i);
    });
    lbStrip.appendChild(thumb);
  });
}

function showImage(next) {
  const total = lightboxItems.length;
  lightboxIndex = ((next % total) + total) % total;
  const item = lightboxItems[lightboxIndex];
  lbImage.src = item.src;
  lbImage.alt = item.label;
  lbCaption.textContent = item.label;
  lbCounter.textContent = lightboxIndex + 1 + ' / ' + total;
  scale = 1;
  rotation = 0;
  applyTransform();
  renderStrip();
}

function closeLightbox() {
  lightbox.dataset.open = 'false';
  lbImage.src = '';
}

function openLightbox(itemNodes, startIndex) {
  /* 元素带 data-lb-group 与 data-lb-label；取组内所有节点的 <img> 作为图集。 */
  lightboxItems = itemNodes.map((node) => {
    const image = node.querySelector('img');
    return {
      src: image ? image.src : '',
      label: node.dataset.lbLabel || '图片',
    };
  });
  lightbox.dataset.open = 'true';
  showImage(startIndex);
}

document.querySelectorAll('[data-lb-group]').forEach((node) => {
  node.addEventListener('click', () => {
    const group = node.dataset.lbGroup;
    const nodes = Array.from(document.querySelectorAll('[data-lb-group="' + group + '"]'));
    openLightbox(nodes, nodes.indexOf(node));
  });
});

lightbox.addEventListener('click', (event) => {
  if (event.target === lightbox || event.target === lbImage) closeLightbox();
});

document.getElementById('lb-close').addEventListener('click', (event) => {
  event.stopPropagation();
  closeLightbox();
});

document.getElementById('lb-prev').addEventListener('click', (event) => {
  event.stopPropagation();
  showImage(lightboxIndex - 1);
});

document.getElementById('lb-next').addEventListener('click', (event) => {
  event.stopPropagation();
  showImage(lightboxIndex + 1);
});

document.getElementById('lb-zoom-in').addEventListener('click', (event) => {
  event.stopPropagation();
  scale = Math.min(scale + 0.25, 4);
  applyTransform();
});

document.getElementById('lb-zoom-out').addEventListener('click', (event) => {
  event.stopPropagation();
  scale = Math.max(scale - 0.25, 0.25);
  applyTransform();
});

document.getElementById('lb-rotate').addEventListener('click', (event) => {
  event.stopPropagation();
  rotation += 90;
  applyTransform();
});

document.getElementById('lb-reset').addEventListener('click', (event) => {
  event.stopPropagation();
  scale = 1;
  rotation = 0;
  applyTransform();
});

document.addEventListener('keydown', (event) => {
  if (lightbox.dataset.open !== 'true') return;
  if (event.key === 'Escape') closeLightbox();
  if (event.key === 'ArrowLeft') showImage(lightboxIndex - 1);
  if (event.key === 'ArrowRight') showImage(lightboxIndex + 1);
  if (event.key === '+' || event.key === '=') {
    scale = Math.min(scale + 0.25, 4);
    applyTransform();
  }
  if (event.key === '-') {
    scale = Math.max(scale - 0.25, 0.25);
    applyTransform();
  }
  if (event.key === '0') {
    scale = 1;
    rotation = 0;
    applyTransform();
  }
  if (event.key === 'r' || event.key === 'R') {
    rotation += 90;
    applyTransform();
  }
});

/* ── 音频演示：波形柱 + 模拟进度 ────────────────────────── */
function buildWave(container) {
  const total = Number(container.dataset.bars || 32);
  container.innerHTML = '';
  for (let i = 0; i < total; i += 1) {
    const bar = document.createElement('i');
    /* 现状用 Math.sin(i * 1.5) 生成 32 根装饰柱；方案 C 用统一的进度条形态。 */
    bar.style.height = 4 + Math.abs(Math.sin(i * 1.5)) * 20 + 'px';
    container.appendChild(bar);
  }
}

document.querySelectorAll('[data-audio-wave]').forEach((container) => {
  buildWave(container);
  container.addEventListener('click', (event) => {
    const rect = container.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    const bars = Array.from(container.querySelectorAll('i'));
    const cut = Math.round(bars.length * ratio);
    bars.forEach((bar, i) => bar.classList.toggle('is-active', i < cut));
  });
});

document.querySelectorAll('[data-audio-play]').forEach((button) => {
  button.addEventListener('click', () => {
    const card = document.getElementById(button.dataset.audioPlay);
    const wave = card ? card.querySelector('[data-audio-wave]') : null;
    if (!wave) return;
    const bars = Array.from(wave.querySelectorAll('i'));
    const playing = button.textContent === '▶';
    button.textContent = playing ? '⏸' : '▶';
    if (!playing) return;
    let step = bars.filter((bar) => bar.classList.contains('is-active')).length;
    const timer = setInterval(() => {
      if (button.textContent !== '⏸') {
        clearInterval(timer);
        return;
      }
      if (step >= bars.length) {
        clearInterval(timer);
        button.textContent = '▶';
        return;
      }
      bars[step].classList.add('is-active');
      step += 1;
    }, 160);
  });
});

document.querySelectorAll('[data-rate-btn]').forEach((button) => {
  const rates = ['1x', '1.5x', '2x', '0.75x'];
  button.addEventListener('click', () => {
    const next = rates.indexOf(button.textContent);
    button.textContent = rates[(next + 1) % rates.length];
  });
});
