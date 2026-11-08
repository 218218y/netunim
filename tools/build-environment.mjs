export const productionProject = 'bupoidcurcxuypfrjqio';
export function buildEnvironment(env = process.env) {
  const preview = Boolean(env.CF_PAGES_BRANCH && env.CF_PAGES_BRANCH !== 'main');
  const environment = env.NETUNIM_BUILD_ENV || (preview ? 'staging' : 'production');
  if (!['production', 'staging'].includes(environment) || preview && environment === 'production') {
    throw Error('Preview builds require an isolated staging backend');
  }
  return environment;
}
export function stagingConfiguration(config) {
  const url = new URL(config?.url);
  if (url.origin !== config.url || !/^https:\/\/[a-z]{20}\.supabase\.co$/.test(config.url) ||
      url.hostname.startsWith(productionProject + '.') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey || '') ||
      Object.keys(config).some(key => !['url', 'publishableKey'].includes(key))) throw Error('Invalid isolated staging configuration');
  return config;
}
export function stagingConfigSource(config) {
  return '// Isolated staging project; browser publishable key only.\nexport const supabaseConfig = Object.freeze(' + JSON.stringify(stagingConfiguration(config)) + ');\n';
}
export function stagingHeaders(source, config) {
  const host = new URL(stagingConfiguration(config).url).hostname;
  return source.replaceAll(productionProject + '.supabase.co', host);
}
