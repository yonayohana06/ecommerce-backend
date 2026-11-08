const MS_PER_SECOND = 1000;

// Cache signed URL di memori dengan TTL lebih pendek dari masa berlaku
// signed URL Supabase (default 3600 detik / 60 menit). Cache disegarkan
// sebelum URL kedaluwarsa agar klien tidak menerima URL yang sudah expired.
const createSignedUrlCache = ({ ttlMs = 5 * 60 * MS_PER_SECOND } = {}) => {
  const entries = new Map();

  const get = (path) => {
    if (!path) {
      return null;
    }

    const entry = entries.get(path);

    if (!entry || entry.expiry <= Date.now()) {
      entries.delete(path);
      return null;
    }

    return entry.url;
  };

  const set = (path, url) => {
    if (!path || !url) {
      return;
    }

    entries.set(path, { url, expiry: Date.now() + ttlMs });
  };

  const has = (path) => Boolean(get(path));

  const clear = () => {
    entries.clear();
  };

  return {
    get,
    set,
    has,
    clear,
    size: () => entries.size,
  };
};

const signedUrlCache = createSignedUrlCache();

module.exports = {
  createSignedUrlCache,
  signedUrlCache,
};
