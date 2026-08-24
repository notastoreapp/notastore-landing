/**
 * Catalog taxonomy — keep in sync with
 * NotAStoreMobile/src/domain/categories.js
 *
 * id     = products.category (Postgres) AND Storage folder
 *          product-images/{id}/{productId}/{file}
 * label  = folder name in this console + chip label in the shopper app
 *
 * Never rename an id that already has rows (handbags is live).
 */
window.NAS_CATALOG = {
  defaultCategory: 'handbags',
  categories: [
    { id: 'handbags', label: 'Luxury bags', hint: 'Totes, shoulders, minis', glyph: '👜' },
    { id: 'watches', label: 'Watches', hint: 'Dress, sport, complications', glyph: '⌚' },
    { id: 'sneakers', label: 'Sneakers', hint: 'Limited drops, court, runners', glyph: '👟' },
    { id: 'electronics', label: 'Electronics', hint: 'Audio, phones, objects of desire', glyph: '📱' },
    { id: 'fashion', label: 'Fashion', hint: 'Ready-to-wear beyond bags', glyph: '👗' },
    { id: 'cars', label: 'Cars', hint: 'Supercars you will never garage', glyph: '🚗' },
    { id: 'homes', label: 'Homes', hint: 'Villas, penthouses, hideaways', glyph: '🏠' },
    { id: 'travel', label: 'Travel', hint: 'Suites, yachts, impossible itineraries', glyph: '✈️' },
    { id: 'gaming', label: 'Gaming', hint: 'Hardware and collector kits', glyph: '🎮' },
  ],
};
