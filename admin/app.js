const catalog = window.NAS_CATALOG || { defaultCategory: 'handbags', categories: [] };
let categories = (catalog.categories || []).map(normalizeFolder);
const DEFAULT_CATEGORY = catalog.defaultCategory || 'handbags';
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 450 * 1024;
const MAX_EDGE = 1600;
const BUCKET = 'product-images';
const STUDIO_FILL = '#EDEBE6';
const FRAME_RATIO = 4 / 5;
const FRAME_INSET = 0.08;
const IMAGE_HINT_DEFAULT =
  'Any format. We place it on a 4:5 studio field and compress — files stay in Supabase, not in git.';

const config = window.NAS_ADMIN || {};
let db = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function' && config.supabaseUrl && config.supabaseAnonKey) {
    db = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  }
} catch (err) {
  db = null;
}

const els = {
  gate: document.getElementById('gate'),
  app: document.getElementById('app'),
  gateError: document.getElementById('gate-error'),
  gateForm: document.getElementById('gate-form'),
  gateEmail: document.getElementById('gate-email'),
  gatePassword: document.getElementById('gate-password'),
  signInBtn: document.getElementById('sign-in-btn'),
  gateHint: document.getElementById('gate-hint'),
  signOut: document.getElementById('sign-out'),
  who: document.getElementById('who'),
  list: document.getElementById('product-list'),
  folderList: document.getElementById('folder-list'),
  addFolderBtn: document.getElementById('add-folder-btn'),
  addFolderForm: document.getElementById('add-folder-form'),
  folderLabel: document.getElementById('folder-label'),
  folderIdPreview: document.getElementById('folder-id-preview'),
  addFolderCancel: document.getElementById('add-folder-cancel'),
  folderFormError: document.getElementById('folder-form-error'),
  listTitle: document.getElementById('list-title'),
  listCrumb: document.getElementById('list-crumb'),
  folderPath: document.getElementById('folder-path'),
  filterSearch: document.getElementById('filter-search'),
  filterStatus: document.getElementById('filter-status'),
  newBtn: document.getElementById('new-btn'),
  form: document.getElementById('product-form'),
  editorTitle: document.getElementById('editor-title'),
  id: document.getElementById('f-id'),
  name: document.getElementById('f-name'),
  brand: document.getElementById('f-brand'),
  price: document.getElementById('f-price'),
  category: document.getElementById('f-category'),
  storagePath: document.getElementById('storage-path'),
  status: document.getElementById('f-status'),
  drop: document.getElementById('f-drop'),
  image: document.getElementById('f-image'),
  preview: document.getElementById('f-preview'),
  previewFrame: document.getElementById('f-preview-frame'),
  imageHint: document.getElementById('image-hint'),
  saveBtn: document.getElementById('save-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  formMsg: document.getElementById('form-msg'),
  formError: document.getElementById('form-error'),
};

let products = [];
let selectedId = null;
let selectedFolder = '';
let existingImageUrl = null;
let idLocked = false;
let pendingImage = null;
let previewUrl = null;

function normalizeFolder(row) {
  if (!row?.id && !row?.label) return null;
  const id = String(row.id || '').trim();
  return {
    id,
    label: row.label || id,
    hint: row.hint || '',
    glyph: row.glyph || '📁',
    icon: row.icon || 'grid',
    sortOrder: Number(row.sort_order ?? row.sortOrder ?? 100) || 100,
  };
}

function categoryIds() {
  return categories.map((item) => item.id);
}

function getCategory(id) {
  return categories.find((item) => item.id === id) || categories[0] || { id: DEFAULT_CATEGORY, label: DEFAULT_CATEGORY };
}

function categoryLabel(id) {
  return getCategory(id).label || id || DEFAULT_CATEGORY;
}

function storageFolder(categoryId) {
  return `product-images/${categoryId || DEFAULT_CATEGORY}/`;
}

function fillCategorySelect() {
  const previous = els.category.value;
  els.category.replaceChildren();
  categories.forEach((item) => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = `${item.label}  (${item.id})`;
    els.category.appendChild(option);
  });
  if (previous && categoryIds().includes(previous)) els.category.value = previous;
  updateStorageHint();
}

function updateStorageHint() {
  setText(els.storagePath, `Stores at ${storageFolder(els.category.value)}`);
}

function show(el) {
  el.classList.remove('hidden');
}
function hide(el) {
  el.classList.add('hidden');
}
function setText(el, text) {
  el.textContent = text || '';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not compress this image.'));
    }, type, quality);
  });
}

async function decodeBitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new Error(
        'Could not read this photo. Try JPEG, PNG, or WebP. HEIC works in Safari.'
      );
    }
  }
}

async function compressImage(file) {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Photo is larger than 25MB. Pick a smaller file.');
  }

  const bitmap = await decodeBitmap(file);
  try {
    const outH = MAX_EDGE;
    const outW = Math.max(1, Math.round(outH * FRAME_RATIO));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = STUDIO_FILL;
    ctx.fillRect(0, 0, outW, outH);

    const boxW = outW * (1 - FRAME_INSET * 2);
    const boxH = outH * (1 - FRAME_INSET * 2);
    const fit = Math.min(boxW / bitmap.width, boxH / bitmap.height);
    const drawW = bitmap.width * fit;
    const drawH = bitmap.height * fit;
    ctx.drawImage(bitmap, (outW - drawW) / 2, (outH - drawH) / 2, drawW, drawH);

    let best = null;
    for (const type of ['image/webp', 'image/jpeg']) {
      let quality = 0.82;
      let blob = await canvasToBlob(canvas, type, quality);
      if (!blob.size || blob.type !== type) continue;
      while (blob.size > TARGET_BYTES && quality > 0.58) {
        quality -= 0.08;
        blob = await canvasToBlob(canvas, type, quality);
      }
      if (!best || blob.size < best.size) best = blob;
      if (best.size <= TARGET_BYTES) break;
    }

    if (!best) throw new Error('Could not compress this image. Try JPEG or PNG.');
    if (best.size > MAX_UPLOAD_BYTES) {
      throw new Error('Compressed photo is still over 5MB. Try a simpler image.');
    }

    const ext = best.type === 'image/webp' ? 'webp' : 'jpg';
    return new File([best], `photo.${ext}`, { type: best.type });
  } finally {
    if (typeof bitmap.close === 'function') bitmap.close();
  }
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function showGateError(message) {
  setText(els.gateError, message);
  show(els.gateError);
}

function showFormError(message) {
  setText(els.formError, message);
  show(els.formError);
  hide(els.formMsg);
}

function showFormMsg(message) {
  setText(els.formMsg, message);
  show(els.formMsg);
  hide(els.formError);
}

function resetForm(product) {
  hide(els.formError);
  hide(els.formMsg);
  els.image.value = '';
  pendingImage = null;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  setText(els.imageHint, IMAGE_HINT_DEFAULT);

  if (!product) {
    selectedId = null;
    existingImageUrl = null;
    idLocked = false;
    els.editorTitle.textContent = 'New product';
    els.id.value = '';
    els.id.readOnly = false;
    els.name.value = '';
    els.brand.value = '';
    els.price.value = '0';
    els.category.value = selectedFolder || DEFAULT_CATEGORY;
    els.status.value = 'published';
    if (els.drop) els.drop.checked = false;
    updateStorageHint();
    hide(els.previewFrame);
    els.preview.removeAttribute('src');
    hide(els.deleteBtn);
    return;
  }

  selectedId = product.id;
  existingImageUrl = product.image || null;
  idLocked = true;
  els.editorTitle.textContent = product.name;
  els.id.value = product.id;
  els.id.readOnly = true;
  els.name.value = product.name || '';
  els.brand.value = product.brand || '';
  els.price.value = String(product.price ?? 0);
  els.category.value = categoryIds().includes(product.category) ? product.category : DEFAULT_CATEGORY;
  els.status.value = product.status || 'draft';
  if (els.drop) els.drop.checked = Boolean(product.drop);
  updateStorageHint();
  if (product.image) {
    els.preview.src = product.image;
    show(els.previewFrame);
  } else {
    hide(els.previewFrame);
    els.preview.removeAttribute('src');
  }
  show(els.deleteBtn);
}

function filteredProducts() {
  const folder = selectedFolder;
  const status = els.filterStatus.value;
  const query = (els.filterSearch.value || '').trim().toLowerCase();
  return products.filter((item) => {
    if (folder && item.category !== folder) return false;
    if (status && item.status !== status) return false;
    if (query) {
      const hay = `${item.name || ''} ${item.brand || ''} ${item.id || ''}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });
}

function folderCounts() {
  const counts = { '': products.length };
  categoryIds().forEach((id) => {
    counts[id] = 0;
  });
  products.forEach((item) => {
    const id = item.category || DEFAULT_CATEGORY;
    counts[id] = (counts[id] || 0) + 1;
  });
  return counts;
}

function renderFolders() {
  els.folderList.replaceChildren();
  const counts = folderCounts();
  const extraIds = Object.keys(counts).filter((id) => id && !categoryIds().includes(id));
  const extra = extraIds.map((id) => ({ id, label: id, glyph: '📁', hint: '' }));
  const rows = [{ id: '', label: 'All products', hint: 'Every folder', glyph: '▦' }, ...categories, ...extra];

  rows.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'folder' + (item.id === selectedFolder ? ' is-active' : '');
    btn.setAttribute('aria-current', item.id === selectedFolder ? 'page' : 'false');

    const glyph = document.createElement('span');
    glyph.className = 'folder__glyph';
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = item.glyph || '📁';

    const body = document.createElement('span');
    body.className = 'folder__body';
    const name = document.createElement('span');
    name.className = 'folder__name';
    name.textContent = item.label;
    const meta = document.createElement('span');
    meta.className = 'folder__meta';
    meta.textContent = item.id ? `${item.id}/` : 'product-images/';
    body.appendChild(name);
    body.appendChild(meta);

    const count = document.createElement('span');
    count.className = 'folder__count';
    count.textContent = String(counts[item.id] ?? 0);

    btn.appendChild(glyph);
    btn.appendChild(body);
    btn.appendChild(count);
    btn.addEventListener('click', () => {
      selectedFolder = item.id;
      if (!idLocked) {
        els.category.value = item.id || DEFAULT_CATEGORY;
        updateStorageHint();
      }
      renderFolders();
      renderList();
    });
    els.folderList.appendChild(btn);
  });
}

function renderList() {
  els.list.replaceChildren();
  const folder = selectedFolder ? getCategory(selectedFolder) : null;
  const title = folder ? folder.label : 'All products';
  setText(els.listTitle, title);
  setText(els.listCrumb, folder ? `Catalog / ${folder.label}` : 'Catalog / All');
  setText(els.folderPath, folder ? storageFolder(folder.id) : 'product-images/');
  els.newBtn.setAttribute('aria-label', folder ? `New product in ${folder.label}` : 'New product');

  const rows = filteredProducts();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = folder
      ? `Nothing in ${folder.label} yet. New products land in this folder.`
      : 'No products match these filters.';
    els.list.appendChild(empty);
    return;
  }

  rows.forEach((product) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card' + (product.id === selectedId ? ' is-active' : '');
    btn.setAttribute('role', 'listitem');

    const frame = document.createElement('span');
    frame.className = 'media-frame media-frame--thumb' + (product.image ? '' : ' is-empty');

    const img = document.createElement('img');
    img.className = 'media-frame__img';
    img.alt = '';
    if (product.image) img.src = product.image;
    frame.appendChild(img);

    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'card__name';
    name.textContent = product.name;

    const pill = document.createElement('span');
    pill.className = 'pill pill--' + (product.status || 'draft');
    pill.textContent = product.status || 'draft';
    name.appendChild(pill);
    if (product.drop) {
      const dropPill = document.createElement('span');
      dropPill.className = 'pill pill--drop';
      dropPill.textContent = 'drop';
      name.appendChild(dropPill);
    }

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    meta.textContent = `${categoryLabel(product.category)} · NAS ${Math.round(Number(product.price) || 0).toLocaleString('en-US')}`;

    body.appendChild(name);
    body.appendChild(meta);
    btn.appendChild(frame);
    btn.appendChild(body);
    btn.addEventListener('click', () => {
      resetForm(product);
      renderList();
    });
    els.list.appendChild(btn);
  });
}

async function loadProducts() {
  const { data, error } = await db.from('products').select('*').order('updated_at', { ascending: false });
  if (error) throw error;
  products = data || [];
  renderFolders();
  renderList();
}

async function requireAdmin(session) {
  const { data, error } = await db
    .from('profiles')
    .select('email, name, is_admin')
    .eq('id', session.user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error(
      'Signed in, but there is no profiles row yet. In SQL Editor run the admin SQL for ' +
        (session.user.email || 'this email') +
        ', then sign in again.'
    );
  }
  if (!data.is_admin) {
    throw new Error(
      'This account is signed in but is not a catalog admin. In Supabase SQL Editor run: update public.profiles set is_admin = true where email = \'' +
        (session.user.email || '') +
        '\';'
    );
  }
  return data;
}

async function loadCategories() {
  const { data, error } = await db.from('categories').select('*').order('sort_order').order('label');
  if (error) {
    categories = (catalog.categories || []).map(normalizeFolder).filter(Boolean);
    return;
  }
  if (data?.length) {
    categories = data.map(normalizeFolder).filter(Boolean);
  }
}

async function enterApp(session) {
  const profile = await requireAdmin(session);
  hide(els.gate);
  show(els.app);
  setText(els.who, profile.email || session.user.email || '');
  await loadCategories();
  fillCategorySelect();
  resetForm(null);
  await loadProducts();
}

async function uploadImage(file, productId, category) {
  if (!file) return existingImageUrl;
  const ext = file.type === 'image/jpeg' ? 'jpg' : 'webp';
  const path = `${category}/${productId}/${Date.now()}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;
  const { data } = db.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function signIn() {
  hide(els.gateError);
  if (!db) {
    showGateError('Admin failed to load. Refresh http://localhost:3000/admin/ in Chrome or Safari.');
    return;
  }
  const email = els.gateEmail.value.trim();
  const password = els.gatePassword.value;
  if (!email || !password) {
    showGateError('Enter email and password.');
    return;
  }
  els.signInBtn.disabled = true;
  try {
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
  } catch (err) {
    showGateError(err.message || 'Sign-in failed.');
    els.signInBtn.disabled = false;
  }
}

els.signInBtn.addEventListener('click', signIn);
els.gateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  signIn();
});
els.gatePassword.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    signIn();
  }
});

els.signOut.addEventListener('click', async () => {
  await db.auth.signOut();
  window.location.href = '/admin/';
});

els.newBtn.addEventListener('click', () => {
  resetForm(null);
  renderList();
});

function updateFolderPreview() {
  const id = slugify(els.folderLabel.value) || 'folder';
  setText(els.folderIdPreview, `Stores as product-images/${id}/`);
}

function openAddFolder() {
  hide(els.folderFormError);
  els.addFolderForm.classList.remove('hidden');
  els.folderLabel.value = '';
  updateFolderPreview();
  els.folderLabel.focus();
}

function closeAddFolder() {
  hide(els.folderFormError);
  els.addFolderForm.classList.add('hidden');
  els.folderLabel.value = '';
}

els.addFolderBtn.addEventListener('click', () => {
  if (els.addFolderForm.classList.contains('hidden')) openAddFolder();
  else closeAddFolder();
});
els.addFolderCancel.addEventListener('click', closeAddFolder);
els.folderLabel.addEventListener('input', updateFolderPreview);
els.addFolderForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  hide(els.folderFormError);
  const label = els.folderLabel.value.trim();
  const id = slugify(label);
  if (!id) {
    setText(els.folderFormError, 'Enter a folder name.');
    show(els.folderFormError);
    return;
  }
  if (categoryIds().includes(id)) {
    setText(els.folderFormError, `“${id}” already exists.`);
    show(els.folderFormError);
    return;
  }

  const sortOrder = categories.reduce((max, item) => Math.max(max, item.sortOrder || 0), 0) + 10;
  const row = { id, label, hint: null, glyph: '📁', icon: 'grid', sort_order: sortOrder };
  const { data, error } = await db.from('categories').insert(row).select('*').single();
  if (error) {
    const missing = /does not exist|schema cache|42P01/i.test(error.message || '');
    setText(
      els.folderFormError,
      missing
        ? 'Run catalog_admin.sql in the Supabase SQL Editor to enable custom folders.'
        : error.message || 'Could not create this folder.'
    );
    show(els.folderFormError);
    return;
  }

  categories.push(normalizeFolder(data || row));
  categories.sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
  fillCategorySelect();
  selectedFolder = id;
  closeAddFolder();
  resetForm(null);
  renderFolders();
  renderList();
});

els.filterSearch.addEventListener('input', renderList);
els.filterStatus.addEventListener('change', renderList);
els.category.addEventListener('change', updateStorageHint);

els.name.addEventListener('input', () => {
  if (!idLocked) els.id.value = slugify(els.name.value);
});

els.image.addEventListener('change', async () => {
  const file = els.image.files[0];
  pendingImage = null;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  if (!file) {
    setText(els.imageHint, IMAGE_HINT_DEFAULT);
    return;
  }
  try {
    pendingImage = await compressImage(file);
    previewUrl = URL.createObjectURL(pendingImage);
    els.preview.src = previewUrl;
    show(els.previewFrame);
    setText(
      els.imageHint,
      `${formatBytes(file.size)} original → ${formatBytes(pendingImage.size)} uploaded`
    );
  } catch (err) {
    els.image.value = '';
    pendingImage = null;
    setText(els.imageHint, IMAGE_HINT_DEFAULT);
    showFormError(err.message || 'Could not read this photo.');
  }
});

els.form.addEventListener('submit', async (event) => {
  event.preventDefault();
  hide(els.formError);
  hide(els.formMsg);
  els.saveBtn.disabled = true;

  try {
    const id = slugify(els.id.value);
    if (!id) throw new Error('Product ID is required.');
    const category = els.category.value;
    const file = pendingImage;
    if (!existingImageUrl && !file) throw new Error('Add a product photo.');

    const image = await uploadImage(file, id, category);
    const row = {
      id,
      name: els.name.value.trim(),
      brand: els.brand.value.trim() || null,
      price: Number(els.price.value) || 0,
      image,
      category,
      status: els.status.value,
      drop: Boolean(els.drop?.checked),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from('products').upsert(row, { onConflict: 'id' }).select('*').single();
    if (error) throw error;

    const idx = products.findIndex((item) => item.id === data.id);
    if (idx >= 0) products[idx] = data;
    else products.unshift(data);

    resetForm(data);
    renderFolders();
    renderList();
    const sizeNote = file ? ` Photo stored at ${formatBytes(file.size)}.` : '';
    const folderName = categoryLabel(data.category);
    const dropNote = data.drop
      ? ' In the daily drop pool — the app unlocks one flagged piece at 16:00 UTC.'
      : '';
    showFormMsg(
      data.status === 'published'
        ? `Published to ${folderName}. It shows in the app immediately — no release needed.${sizeNote}${dropNote}`
        : `Saved in ${folderName}.${sizeNote}${dropNote}`
    );
  } catch (err) {
    showFormError(err.message || 'Could not save this product.');
  } finally {
    els.saveBtn.disabled = false;
  }
});

els.deleteBtn.addEventListener('click', async () => {
  if (!selectedId) return;
  if (!window.confirm(`Delete ${selectedId}? This removes it from the app catalog.`)) return;
  const { error } = await db.from('products').delete().eq('id', selectedId);
  if (error) {
    showFormError(error.message);
    return;
  }
  products = products.filter((item) => item.id !== selectedId);
  resetForm(null);
  renderFolders();
  renderList();
  showFormMsg('Deleted.');
});

(async function boot() {
  fillCategorySelect();
  if (!db) {
    showGateError('Admin failed to load the auth library. Refresh http://localhost:3000/admin/');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.has('email') || params.has('password')) {
    window.history.replaceState({}, '', '/admin/');
  }
  const oauthError = params.get('error_description') || params.get('error');
  if (oauthError) showGateError(oauthError);

  const { data } = await db.auth.getSession();
  if (data.session) {
    try {
      await enterApp(data.session);
    } catch (err) {
      show(els.gate);
      hide(els.app);
      showGateError(err.message);
      els.signInBtn.disabled = false;
    }
  }

  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      try {
        await enterApp(session);
      } catch (err) {
        show(els.gate);
        hide(els.app);
        showGateError(err.message);
        els.signInBtn.disabled = false;
      }
    }
  });
})();
