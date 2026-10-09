// vitest.config.ts aliases this to the installed wrangler package. In tests, 'wrangler' itself is tests/helpers/wrangler.ts.
declare module '@flarewatch/unwrapped-wrangler' {
  export * from 'wrangler';
}
