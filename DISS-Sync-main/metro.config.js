const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Enable tree-shaking — dead code in large packages like Firebase gets stripped
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    keep_classnames: false,
    keep_fnames: false,
    mangle: { toplevel: false },
    output: { ascii_only: true, quote_style: 3, wrap_iife: true },
    sourceMap: { includeSources: false },
    toplevel: false,
    compress: {
      reduce_funcs: false,
      // Remove console.log statements in production builds
      drop_console: true,
    },
  },
};

// Resolve Firebase modular imports correctly (prevents duplicate modules)
config.resolver = {
  ...config.resolver,
  unstable_enablePackageExports: true,
};

module.exports = config;
