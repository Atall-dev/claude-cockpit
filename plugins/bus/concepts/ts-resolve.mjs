// Lets node resolve the mod's extensionless relative imports ('./sky') to .ts files, as the engine does.
// node --import ./concepts/ts-resolve.mjs concepts/pane-preview.mts ...
import { registerHooks } from 'node:module'

registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx)
    } catch (e) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(spec + '.ts', ctx)
      throw e
    }
  },
})
