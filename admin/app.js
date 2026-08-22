const CATEGORIES = ['handbags', 'fashion', 'cars', 'homes', 'travel', 'gaming'];
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const TARGET_BYTES = 450 * 1024;
const MAX_EDGE = 1600;
const BUCKET = 'product-images';
const IMAGE_HINT_DEFAULT = 'Resized to 1600px WebP before upload. Camera originals are fine.';

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
  filterCategory: document.getElementById('filter-category'),
  filterStatus: document.getElementById('filter-status'),
  newBtn: document.getElementById('new-btn'),
  form: document.getElementById('product-form'),
  editorTitle: document.getElementById('editor-title'),
  id: document.getElementById('f-id'),
  name: document.getElementById('f-name'),
  brand: document.getElementById('f-brand'),
  price: document.getElementById('f-price'),
  category: document.getElementById('f-category'),
  status: document.getElementById('f-status'),
  image: document.getElementById('f-image'),
  preview: document.getElementById('f-preview'),
  imageHint: document.getElementById('image-hint'),
  saveBtn: document.getElementById('save-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  formMsg: document.getElementById('form-msg'),
  formError: document.getElementById('form-error'),
};

let products = [];
let selectedId = null;
let existingImageUrl = null;
let idLocked = false;
let pendingImage = null;
let previewUrl = null;

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

async function compressImage(file) {
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Photo is larger than 25MB. Pick a smaller file.');
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Could not read this photo. Use JPEG, PNG, or WebP.');
  });
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);

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
    els.category.value = 'handbags';
    els.status.value = 'published';
    hide(els.preview);
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
  els.category.value = CATEGORIES.includes(product.category) ? product.category : 'handbags';
  els.status.value = product.status || 'draft';
  if (product.image) {
    els.preview.src = product.image;
    show(els.preview);
  } else {
    hide(els.preview);
    els.preview.removeAttribute('src');
  }
  show(els.deleteBtn);
}

function filteredProducts() {
  const category = els.filterCategory.value;
  const status = els.filterStatus.value;
  return products.filter((item) => {
    if (category && item.category !== category) return false;
    if (status && item.status !== status) return false;
    return true;
  });
}

function renderList() {
  els.list.replaceChildren();
  const rows = filteredProducts();
  if (!rows.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No products match these filters.';
    els.list.appendChild(empty);
    return;
  }

  rows.forEach((product) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'card' + (product.id === selectedId ? ' is-active' : '');

    const img = document.createElement('img');
    img.alt = '';
    if (product.image) img.src = product.image;

    const body = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'card__name';
    name.textContent = product.name;

    const pill = document.createElement('span');
    pill.className = 'pill pill--' + (product.status || 'draft');
    pill.textContent = product.status || 'draft';
    name.appendChild(pill);

    const meta = document.createElement('div');
    meta.className = 'card__meta';
    meta.textContent = `${product.category || 'handbags'} · NAS ${Number(product.price || 0).toLocaleString('en-US')}`;

    body.appendChild(name);
    body.appendChild(meta);
    btn.appendChild(img);
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

async function enterApp(session) {
  const profile = await requireAdmin(session);
  hide(els.gate);
  show(els.app);
  setText(els.who, profile.email || session.user.email || '');
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

els.filterCategory.addEventListener('change', renderList);
els.filterStatus.addEventListener('change', renderList);

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
    show(els.preview);
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
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await db.from('products').upsert(row, { onConflict: 'id' }).select('*').single();
    if (error) throw error;

    const idx = products.findIndex((item) => item.id === data.id);
    if (idx >= 0) products[idx] = data;
    else products.unshift(data);

    resetForm(data);
    renderList();
    const sizeNote = file ? ` Photo stored at ${formatBytes(file.size)}.` : '';
    showFormMsg(
      data.status === 'published'
        ? `Published. Handbags show in the app immediately — no release needed.${sizeNote}`
        : `Saved.${sizeNote}`
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
  renderList();
  showFormMsg('Deleted.');
});

(async function boot() {
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
