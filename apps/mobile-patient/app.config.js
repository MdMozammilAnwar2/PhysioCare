// Extends app.json. ALLOW_HTTP=1 lets a local test APK talk to a plain http:// API on your Wi-Fi
// (e.g. http://192.168.1.4:4000). Store builds never set it, so they only use https.
module.exports = ({ config }) => {
  if (process.env.ALLOW_HTTP !== '1') return config;
  return { ...config, plugins: [...(config.plugins ?? []), ['expo-build-properties', { android: { usesCleartextTraffic: true } }]] };
};
