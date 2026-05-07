import { getKoongyaImagePath, normalizeKoongyaId } from '../data/koongyas.js';

export function getEl(id) {
  return document.getElementById(id);
}

export function showToast(message) {
  const container = getEl('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerText = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

export function hideLoadingOverlay() {
  const overlay = getEl('loading-overlay');
  if (overlay && overlay.style.display !== 'none') {
    overlay.style.display = 'none';
    console.log('[Performance] 로딩 완료');
  }
}

export function saveGardenToLocal(data) {
  localStorage.setItem('cached_garden', JSON.stringify(data));
}

export function loadGardenFromLocal(renderGarden) {
  const cached = localStorage.getItem('cached_garden');
  if (cached) {
    const data = JSON.parse(cached);
    renderGarden(data);
    hideLoadingOverlay();
  }
}

export function renderGarden(data) {
  const cells = document.querySelectorAll('.cell');
  cells.forEach((cell) => {
    cell.classList.add('empty');
    cell.classList.remove('has-koongya');
    cell.innerHTML = '';
    cell.removeAttribute('data-db-id');
  });

  data.forEach((item) => {
    const cell = document.querySelector(`.cell[data-index="${item.cell_index}"]`);
    if (cell) {
      cell.classList.remove('empty');
      cell.classList.add('has-koongya');
      const koongyaId = normalizeKoongyaId(item.koongya_type);
      const imagePath = getKoongyaImagePath(koongyaId, item.current_step);
      cell.setAttribute('data-koongya-id', koongyaId);
      cell.setAttribute('data-db-id', item.id);
      cell.setAttribute('data-step', item.current_step);
      cell.innerHTML = `<img src="${imagePath}" class="koongya-sprite" alt="${koongyaId} 쿵야" loading="lazy">`;
    }
  });
}
