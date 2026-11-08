process.env.SUPABASE_URL = 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
const supabase = require('../src/config/supabase');
const batchCalls = [];
console.log('storage same (pre):', supabase.storage === supabase.storage);
supabase.storage.from = (bucket) => ({
  createSignedUrls: async (paths, expiresIn) => {
    batchCalls.push({ bucket, paths, expiresIn });
    console.log('MOCK createSignedUrls called:', paths);
    return { data: paths.map((p) => ({ path: p, signedURL: 'https://example.test/signed/' + encodeURIComponent(p) })), error: null };
  }
});
const { generateSignedUrls, clearSignedUrlCache } = require('../src/services/paymentService');
clearSignedUrlCache();
(async () => {
  const r = await generateSignedUrls(['a.png','b.png']);
  console.log('batchCalls:', JSON.stringify(batchCalls));
  console.log('result a.png:', r.get('a.png'));
  console.log('result size:', r.size);
})();
